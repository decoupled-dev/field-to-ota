// Package scrub redacts personal data from log lines before they leave the vehicle.
package scrub

import "regexp"

var (
	mac   = regexp.MustCompile(`\b([0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}\b`)
	email = regexp.MustCompile(`[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}`)
	// Phone formats are deliberately strict so logcat timestamps and PIDs are never touched.
	phoneIntl = regexp.MustCompile(`\+\d{1,3}[\s-]?\(?\d{2,4}\)?[\s-]?\d{3,4}[\s-]?\d{3,4}\b`)
	phoneNA   = regexp.MustCompile(`\(\d{3}\)\s?\d{3}-\d{4}\b|\b\d{3}-\d{3}-\d{4}\b`)
)

func Line(s string) string {
	s = mac.ReplaceAllString(s, "XX:XX:XX:XX:XX:XX")
	s = email.ReplaceAllString(s, "<email>")
	s = phoneIntl.ReplaceAllString(s, "<phone>")
	s = phoneNA.ReplaceAllString(s, "<phone>")
	return s
}
