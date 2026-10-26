#!/usr/bin/env python3
"""Field-to-Fix on AWS (CDK v2, Python).

    cd infra && .venv/bin/python app.py            # synth to cdk.out (no AWS account needed)
    npx cdk deploy --app ".venv/bin/python app.py"  # deploy (needs credentials + Bedrock model access)
"""
from __future__ import annotations

import shutil
from pathlib import Path

import aws_cdk as cdk
from aws_cdk import (
    Duration,
    RemovalPolicy,
    aws_apprunner as apprunner,
    aws_bedrock as bedrock,
    aws_cognito as cognito,
    aws_dynamodb as ddb,
    aws_ecr_assets as ecr_assets,
    aws_events as events,
    aws_events_targets as targets,
    aws_iam as iam,
    aws_iot as iot,
    aws_lambda as lambda_,
    aws_s3 as s3,
    aws_scheduler as scheduler,
    aws_stepfunctions as sfn,
    aws_stepfunctions_tasks as tasks,
)
from constructs import Construct

ROOT = Path(__file__).resolve().parent.parent

# Stage groups executed per Step Functions state (each group shares one Lambda invocation / working copy).
GROUPS = [
    ("Intake", ["detect", "triage", "ticket"]),
    ("Analyze", ["fleet", "reproduce", "rca"]),
    ("Engineer", ["requirement", "fix", "verify"]),
]


class FieldToFixStack(cdk.Stack):
    def __init__(self, scope: Construct, cid: str, **kw):
        super().__init__(scope, cid, **kw)

        # Copy seed data into Lambda asset bundle so it is available at /var/task/data/
        _seed_src = ROOT / "data" / "stellantis_seed_issues.json"
        _seed_dst = ROOT / "infra" / "lambda_" / "field_discovery" / "data" / "stellantis_seed_issues.json"
        _seed_dst.parent.mkdir(parents=True, exist_ok=True)
        if _seed_src.exists():
            shutil.copy2(_seed_src, _seed_dst)

        # Data ------------------------------------------------------------------------------------
        table = ddb.Table(self, "State", partition_key=ddb.Attribute(name="pk", type=ddb.AttributeType.STRING),
                          sort_key=ddb.Attribute(name="sk", type=ddb.AttributeType.STRING),
                          billing_mode=ddb.BillingMode.PAY_PER_REQUEST, stream=ddb.StreamViewType.NEW_IMAGE,
                          removal_policy=RemovalPolicy.DESTROY)
        field_issues_table = ddb.Table(self, "FieldIssues",
                                       partition_key=ddb.Attribute(name="pk", type=ddb.AttributeType.STRING),
                                       sort_key=ddb.Attribute(name="sk", type=ddb.AttributeType.STRING),
                                       billing_mode=ddb.BillingMode.PAY_PER_REQUEST,
                                       removal_policy=RemovalPolicy.DESTROY)
        bundles = s3.Bucket(self, "Bundles", encryption=s3.BucketEncryption.S3_MANAGED, enforce_ssl=True,
                            block_public_access=s3.BlockPublicAccess.BLOCK_ALL,
                            lifecycle_rules=[s3.LifecycleRule(expiration=Duration.days(90))],
                            removal_policy=RemovalPolicy.DESTROY, auto_delete_objects=True)
        telemetry = s3.Bucket(self, "Telemetry", encryption=s3.BucketEncryption.S3_MANAGED, enforce_ssl=True,
                              block_public_access=s3.BlockPublicAccess.BLOCK_ALL, removal_policy=RemovalPolicy.DESTROY,
                              auto_delete_objects=True)
        bus = events.EventBus(self, "Bus", event_bus_name="field-to-fix")

        # Code: one container image for console + Lambdas -------------------------------------
        excludes = [".venv", "infra/.venv", "infra/cdk.out", "frontend/node_modules", ".state", ".hu", ".keys", ".git"]
        env = {"F2F_MODE": "aws", "F2F_TABLE": table.table_name, "F2F_EVENT_BUS": bus.event_bus_name,
               "F2F_ARTIFACT_BUCKET": bundles.bucket_name, "F2F_IOT_THING_GROUP": "f2f-affected-cohort",
               "F2F_STATE_DIR": "/tmp/f2f", "F2F_KEYS_DIR": "/tmp/f2f/keys"}

        def fn(name: str, handler: str, timeout_min: int = 15, memory: int = 2048) -> lambda_.DockerImageFunction:
            f = lambda_.DockerImageFunction(self, name, code=lambda_.DockerImageCode.from_image_asset(
                str(ROOT), file="infra/Dockerfile.lambda", cmd=[handler], exclude=excludes),
                timeout=Duration.minutes(timeout_min), memory_size=memory, environment=env, architecture=lambda_.Architecture.X86_64)
            table.grant_read_write_data(f)
            bundles.grant_read_write(f)
            bus.grant_put_events_to(f)
            return f

        stage_fn = fn("StageGroup", "backend.app.aws_lambda.stage_group")
        device_fn = fn("DeviceIngest", "backend.app.aws_lambda.device_ingest", 2, 1024)
        crawl_fn = fn("Crawl", "backend.app.aws_lambda.crawl", 5, 1024)
        bedrock_policy = iam.PolicyStatement(actions=["bedrock:InvokeModel", "bedrock:Converse", "bedrock:Retrieve"], resources=["*"])
        for f in (stage_fn, device_fn, crawl_fn):
            f.add_to_role_policy(bedrock_policy)
        stage_fn.add_to_role_policy(iam.PolicyStatement(
            actions=["iot:CreateJob", "iot:DescribeThing", "iot:DescribeJob", "athena:StartQueryExecution", "athena:GetQueryResults",
                     "signer:StartSigningJob", "secretsmanager:GetSecretValue"], resources=["*"]))

        # Field Discovery: Lambda action-group handlers + Bedrock Agent -------------------------
        _fd_env = {
            "FIELD_ISSUES_TABLE": field_issues_table.table_name,
            "SEED_DATA_PATH": "/var/task/data/stellantis_seed_issues.json",
            "AWS_REGION_NAME": self.region,
        }
        search_fn = lambda_.Function(self, "FieldDiscoverySearch",
                                     code=lambda_.Code.from_asset(str(ROOT / "infra" / "lambda_" / "field_discovery")),
                                     runtime=lambda_.Runtime.PYTHON_3_12,
                                     handler="handler.lambda_handler",
                                     timeout=Duration.minutes(5),
                                     memory_size=512,
                                     environment=_fd_env)
        ingest_fn = lambda_.Function(self, "FieldDiscoveryIngest",
                                     code=lambda_.Code.from_asset(str(ROOT / "infra" / "lambda_" / "field_discovery")),
                                     runtime=lambda_.Runtime.PYTHON_3_12,
                                     handler="ingest.lambda_handler",
                                     timeout=Duration.minutes(5),
                                     memory_size=512,
                                     environment=_fd_env)
        field_issues_table.grant_read_write_data(search_fn)
        field_issues_table.grant_read_write_data(ingest_fn)
        _bedrock_policy = iam.PolicyStatement(actions=["bedrock:InvokeModel", "bedrock:Converse"], resources=["*"])
        search_fn.add_to_role_policy(_bedrock_policy)
        ingest_fn.add_to_role_policy(_bedrock_policy)

        agent_role = iam.Role(self, "FieldDiscoveryAgentRole",
                              assumed_by=iam.ServicePrincipal("bedrock.amazonaws.com"))
        agent_role.add_to_policy(iam.PolicyStatement(actions=["bedrock:InvokeModel"], resources=["*"]))
        agent_role.add_to_policy(iam.PolicyStatement(
            actions=["lambda:InvokeFunction"],
            resources=[search_fn.function_arn, ingest_fn.function_arn]))

        search_fn.add_permission("AllowBedrock",
                                 principal=iam.ServicePrincipal("bedrock.amazonaws.com"),
                                 action="lambda:InvokeFunction")
        ingest_fn.add_permission("AllowBedrock",
                                 principal=iam.ServicePrincipal("bedrock.amazonaws.com"),
                                 action="lambda:InvokeFunction")

        field_discovery_agent = bedrock.CfnAgent(self, "FieldDiscoveryAgent",
            agent_name="field-discovery-agent",
            foundation_model="anthropic.claude-3-5-sonnet-20241022-v2:0",
            agent_resource_role_arn=agent_role.role_arn,
            instruction=(
                "You are a field intelligence analyst for automotive OEMs. Given an OEM name and vehicle model list, "
                "systematically search all configured complaint and feedback sources for software-related issues. "
                "Call search_all_sources to crawl all sources in parallel, then call ingest_issues to store and "
                "deduplicate the results. Return a structured JSON report containing: total_issues, "
                "deduplicated_count, actionable_issues (list of issues with is_actionable_in_mvp=true), "
                "source_coverage (per-source live/simulated status), top_priority_issues (top 5 by "
                "frequency_score descending)."
            ),
            action_groups=[
                bedrock.CfnAgent.AgentActionGroupProperty(
                    action_group_name="web-search-action",
                    action_group_executor=bedrock.CfnAgent.ActionGroupExecutorProperty(
                        lambda_=search_fn.function_arn),
                    action_group_state="ENABLED",
                    function_schema=bedrock.CfnAgent.FunctionSchemaProperty(
                        functions=[
                            bedrock.CfnAgent.FunctionProperty(
                                name="search_all_sources",
                                description="Search all configured sources for OEM issues",
                                parameters={
                                    "oem": bedrock.CfnAgent.ParameterDetailProperty(
                                        type="string", description="OEM name e.g. Stellantis", required=True),
                                    "models": bedrock.CfnAgent.ParameterDetailProperty(
                                        type="string", description="Comma-separated vehicle model names", required=True),
                                    "since_days": bedrock.CfnAgent.ParameterDetailProperty(
                                        type="integer", description="Look back window in days", required=False),
                                }),
                            bedrock.CfnAgent.FunctionProperty(
                                name="search_source",
                                description="Search one specific source",
                                parameters={
                                    "source_name": bedrock.CfnAgent.ParameterDetailProperty(
                                        type="string", description="Source name from DISCOVERY_SOURCES", required=True),
                                    "query": bedrock.CfnAgent.ParameterDetailProperty(
                                        type="string", description="Search query string", required=True),
                                    "since_days": bedrock.CfnAgent.ParameterDetailProperty(
                                        type="integer", description="Look back window in days", required=False),
                                }),
                        ])),
                bedrock.CfnAgent.AgentActionGroupProperty(
                    action_group_name="issue-ingest-action",
                    action_group_executor=bedrock.CfnAgent.ActionGroupExecutorProperty(
                        lambda_=ingest_fn.function_arn),
                    action_group_state="ENABLED",
                    function_schema=bedrock.CfnAgent.FunctionSchemaProperty(
                        functions=[
                            bedrock.CfnAgent.FunctionProperty(
                                name="ingest_issues",
                                description="Store and deduplicate discovered issues into DynamoDB",
                                parameters={
                                    "oem": bedrock.CfnAgent.ParameterDetailProperty(
                                        type="string", description="OEM name", required=True),
                                    "issues_json": bedrock.CfnAgent.ParameterDetailProperty(
                                        type="string", description="JSON array string of issue objects", required=True),
                                }),
                        ])),
            ],
            auto_prepare=True)

        field_discovery_alias = bedrock.CfnAgentAlias(self, "FieldDiscoveryLive",
                                                       agent_id=field_discovery_agent.ref,
                                                       agent_alias_name="live")

        cdk.CfnOutput(self, "FieldDiscoveryAgentId", value=field_discovery_agent.ref)
        cdk.CfnOutput(self, "FieldDiscoveryAliasArn", value=field_discovery_alias.attr_agent_alias_arn)

        # Orchestration: Step Functions ---------------------------------------------------------
        def group(name: str, stages: list[str]) -> tasks.LambdaInvoke:
            return tasks.LambdaInvoke(self, name, lambda_function=stage_fn, result_path=sfn.JsonPath.DISCARD,
                                      payload=sfn.TaskInput.from_object({"case_id": sfn.JsonPath.string_at("$.case_id"), "stages": stages}),
                                      retry_on_service_exceptions=True)

        approval = tasks.LambdaInvoke(self, "AwaitApproval", lambda_function=stage_fn, result_path="$.approval",
                                      integration_pattern=sfn.IntegrationPattern.WAIT_FOR_TASK_TOKEN, task_timeout=sfn.Timeout.duration(Duration.days(3)),
                                      payload=sfn.TaskInput.from_object({"case_id": sfn.JsonPath.string_at("$.case_id"), "stages": ["approve"],
                                                                         "task_token": sfn.JsonPath.task_token}))
        failed = sfn.Fail(self, "CaseFailed")
        chain = sfn.Chain.start(group(*GROUPS[0]))
        for g in GROUPS[1:]:
            chain = chain.next(group(*g))
        chain = chain.next(approval).next(group("Release", ["release"])).next(group("MonitorAndClose", ["monitor"])).next(sfn.Succeed(self, "Closed"))
        machine = sfn.StateMachine(self, "Pipeline", state_machine_name="field-to-fix-pipeline",
                                   definition_body=sfn.DefinitionBody.from_chainable(
                                       sfn.Parallel(self, "Run", result_path=sfn.JsonPath.DISCARD).branch(chain).add_catch(failed)),
                                   timeout=Duration.days(4), tracing_enabled=True)
        machine.grant_task_response(stage_fn)

        events.Rule(self, "BugDetected", event_bus=bus, event_pattern=events.EventPattern(source=["f2f.console"], detail_type=["bug.detected"]),
                    targets=[targets.SfnStateMachine(machine, input=events.RuleTargetInput.from_object(
                        {"case_id": events.EventField.from_path("$.detail.case_id")}))])

        # Intake: crawlers on a schedule ----------------------------------------------------------
        sched_role = iam.Role(self, "SchedulerRole", assumed_by=iam.ServicePrincipal("scheduler.amazonaws.com"))
        crawl_fn.grant_invoke(sched_role)
        for src, rate in (("forum", "rate(2 minutes)"), ("reddit", "rate(15 minutes)")):
            scheduler.CfnSchedule(self, f"Crawl{src.title()}", schedule_expression=rate,
                                  flexible_time_window=scheduler.CfnSchedule.FlexibleTimeWindowProperty(mode="OFF"),
                                  target=scheduler.CfnSchedule.TargetProperty(arn=crawl_fn.function_arn, role_arn=sched_role.role_arn,
                                                                              input=f'{{"source": "{src}"}}'))

        # Device plane: IoT Core ------------------------------------------------------------------
        iot.CfnThingGroup(self, "Cohort", thing_group_name="f2f-affected-cohort")
        iot.CfnThing(self, "DemoThing", thing_name="hu-demo-001")
        iot.CfnPolicy(self, "DevicePolicy", policy_name="f2f-hu-sentinel", policy_document={"Version": "2012-10-17", "Statement": [
            {"Effect": "Allow", "Action": ["iot:Publish"], "Resource": [f"arn:aws:iot:{self.region}:{self.account}:topic/f2f/devices/${{iot:Connection.Thing.ThingName}}/*"]},
            {"Effect": "Allow", "Action": ["iot:DescribeJobExecution", "iot:GetPendingJobExecutions", "iot:StartNextPendingJobExecution",
                                           "iot:UpdateJobExecution"], "Resource": [f"arn:aws:iot:{self.region}:{self.account}:thing/${{iot:Connection.Thing.ThingName}}"]}]})
        device_fn.add_permission("IotInvoke", principal=iam.ServicePrincipal("iot.amazonaws.com"))
        iot.CfnTopicRule(self, "DeviceEvents", topic_rule_payload=iot.CfnTopicRule.TopicRulePayloadProperty(
            sql="SELECT * FROM 'f2f/devices/+/events'", aws_iot_sql_version="2016-03-23",
            actions=[iot.CfnTopicRule.ActionProperty(lambda_=iot.CfnTopicRule.LambdaActionProperty(function_arn=device_fn.function_arn))]))

        # Console: App Runner + Cognito -----------------------------------------------------------
        users = cognito.UserPool(self, "Users", self_sign_up_enabled=False, sign_in_aliases=cognito.SignInAliases(email=True),
                                 removal_policy=RemovalPolicy.DESTROY)
        users.add_client("Console", auth_flows=cognito.AuthFlow(user_srp=True))
        console_image = ecr_assets.DockerImageAsset(self, "ConsoleImage", directory=str(ROOT), file="Dockerfile",
                                                    exclude=excludes + ["infra"])
        instance_role = iam.Role(self, "ConsoleRole", assumed_by=iam.ServicePrincipal("tasks.apprunner.amazonaws.com"))
        table.grant_read_write_data(instance_role)
        bundles.grant_read_write(instance_role)
        bus.grant_put_events_to(instance_role)
        machine.grant_task_response(instance_role)
        instance_role.add_to_policy(bedrock_policy)
        access_role = iam.Role(self, "ConsoleAccess", assumed_by=iam.ServicePrincipal("build.apprunner.amazonaws.com"))
        console_image.repository.grant_pull(access_role)
        svc = apprunner.CfnService(self, "Console", service_name="field-to-fix-console",
            source_configuration=apprunner.CfnService.SourceConfigurationProperty(
                authentication_configuration=apprunner.CfnService.AuthenticationConfigurationProperty(access_role_arn=access_role.role_arn),
                image_repository=apprunner.CfnService.ImageRepositoryProperty(
                    image_identifier=console_image.image_uri, image_repository_type="ECR",
                    image_configuration=apprunner.CfnService.ImageConfigurationProperty(
                        port="8000", runtime_environment_variables=[apprunner.CfnService.KeyValuePairProperty(name=k, value=v) for k, v in env.items()]))),
            instance_configuration=apprunner.CfnService.InstanceConfigurationProperty(cpu="1 vCPU", memory="2 GB", instance_role_arn=instance_role.role_arn),
            health_check_configuration=apprunner.CfnService.HealthCheckConfigurationProperty(protocol="HTTP", path="/api/health"))

        cdk.CfnOutput(self, "ConsoleUrl", value=cdk.Fn.join("", ["https://", svc.attr_service_url]))
        cdk.CfnOutput(self, "StateMachine", value=machine.state_machine_arn)
        cdk.CfnOutput(self, "TelemetryBucket", value=telemetry.bucket_name)
        cdk.CfnOutput(self, "UserPool", value=users.user_pool_id)


app = cdk.App()
FieldToFixStack(app, "FieldToFix", env=cdk.Environment(region="us-east-1"))
app.synth()
