package security

import (
	"fmt"
	"net/url"
	"strings"
)

// BuildAPIURL validates baseURL (http/https scheme, non-empty host) and returns
// baseURL joined with endpoint. Use this at any call site where a user-supplied
// base URL reaches an http.Request so the scheme cannot be file://, gopher://,
// etc. Returned string is safe to pass to http.NewRequestWithContext.
//
// Threat model note: this does NOT satisfy CodeQL's go/request-forgery sanitizer
// because that query requires hostname allowlisting, which is impractical for a
// desktop app supporting self-hosted ZEDEDA deployments. In our model the user
// is the only entity who can configure BaseURL; they send their own credentials
// to their own chosen endpoint, so there is no untrusted attacker in the loop.
// See dismissed alerts on PR #83 for history.
func BuildAPIURL(baseURL, endpoint string) (string, error) {
	u, err := url.Parse(strings.TrimSpace(baseURL))
	if err != nil {
		return "", fmt.Errorf("invalid base URL: %w", err)
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return "", fmt.Errorf("base URL scheme must be http or https, got %q", u.Scheme)
	}
	if u.Host == "" {
		return "", fmt.Errorf("base URL has no host")
	}
	// ResolveReference handles leading slashes vs. relative endpoints uniformly.
	ref, err := url.Parse(endpoint)
	if err != nil {
		return "", fmt.Errorf("invalid endpoint: %w", err)
	}
	return u.ResolveReference(ref).String(), nil
}
