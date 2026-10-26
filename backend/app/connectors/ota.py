"""OTA connectors: AWS IoT Jobs, or the console's device plane that mirrors IoT Jobs semantics."""
from __future__ import annotations

import json

from ..config import settings
from ..store import store
from .base import ConnectorInfo


class AwsIotJobs:
    def __init__(self):
        import boto3
        self.info = ConnectorInfo("aws_iot_jobs", "AWS IoT Jobs", "AWS", "ota",
                                  "Signed OTA jobs with staged rollout to an IoT thing group.", "connected",
                                  ["F2F_IOT_THING_GROUP", "F2F_ARTIFACT_BUCKET"])
        self._iot = boto3.client("iot", region_name=settings.aws_region)

    def create_job(self, job_id, targets, document, canary) -> str:
        arns = [self._iot.describe_thing(thingName=t)["thingArn"] for t in targets]
        self._iot.create_job(jobId=job_id, targets=arns, document=json.dumps(document), targetSelection="SNAPSHOT",
                             jobExecutionsRolloutConfig={"exponentialRate": {
                                 "baseRatePerMinute": max(canary, 1), "incrementFactor": 2.0,
                                 "rateIncreaseCriteria": {"numberOfSucceededThings": max(canary, 1)}}},
                             abortConfig={"criteriaList": [{"failureType": "FAILED", "action": "CANCEL",
                                                            "thresholdPercentage": 10, "minNumberOfExecutedThings": 1}]})
        return f"https://{settings.aws_region}.console.aws.amazon.com/iot/home#/job/{job_id}"


class DevicePlaneJobs:
    def __init__(self):
        self.info = ConnectorInfo("aws_iot_jobs", "AWS IoT Jobs", "AWS", "ota",
                                  "Signed OTA jobs with staged rollout to an IoT thing group.", "simulated",
                                  ["F2F_IOT_THING_GROUP", "F2F_ARTIFACT_BUCKET"])

    def create_job(self, job_id, targets, document, canary) -> str:
        for thing in targets:
            store.put_doc("kv", f"job:{thing}:{job_id}", {"job_id": job_id, "thing": thing, "document": document,
                                                          "status": "QUEUED", "details": {}})
        return f"{settings.public_url}/api/jobs/{job_id}"


def ota_provider():
    if settings.mode == "aws":
        return AwsIotJobs()
    return DevicePlaneJobs()
