package scrub

import "testing"

func TestScrub(t *testing.T) {
	cases := map[string]string{
		"BluetoothA2dp: connect 3C:5A:B4:01:9F:EE ok":   "BluetoothA2dp: connect XX:XX:XX:XX:XX:XX ok",
		"Contacts: synced john.doe@example.com":         "Contacts: synced <email>",
		"Telecom: incoming call from +49 151 2345 6789": "Telecom: incoming call from <phone>",
		"Telecom: dial (555) 123-4567":                  "Telecom: dial <phone>",
		"Telecom: dial 555-123-4567":                    "Telecom: dial <phone>",
	}
	for in, want := range cases {
		if got := Line(in); got != want {
			t.Errorf("Line(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestScrubLeavesLogcatHeaderAlone(t *testing.T) {
	in := "10-26 21:11:44.906  1120  1157 I CarService: ignition ON, ambient=-7.8C, hu_sw=HU-2.3.1"
	if got := Line(in); got != in {
		t.Fatalf("logcat header modified: %q", got)
	}
}
