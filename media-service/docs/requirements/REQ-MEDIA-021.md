# REQ-MEDIA-021: Bluetooth audio availability after ignition

| Field | Value |
|---|---|
| ID | REQ-MEDIA-021 |
| Parent | SYS-HMI-004 (Projection & media continuity) |
| ASIL | QM |
| Status | Released (HU-2.3.0) |

## Requirement
After ignition-on, the media service shall resume Bluetooth A2DP audio from a paired phone within 3 s.
The audio stream shall start no later than 200 ms after A2DP sink init.

## Verification
- TC-MEDIA-021-01: warm boot (ambient 20 °C), audio resumes without underruns.
