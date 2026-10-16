# Security policy

## Supported version

Security fixes are applied to the latest version on the default branch.

## Reporting a vulnerability

Do not open a public issue with credentials, tokens, tenant identifiers or exploit details. Use GitHub's private
vulnerability reporting for this repository. If private reporting is unavailable, contact the repository owner
privately and include only the minimum information needed to reproduce the issue.

## Handling secrets and recordings

- Never commit provider API keys, `.env` files, browser profiles, access tokens, tenant configuration or recordings
  from a real deployment.
- Use synthetic data in examples. Keep local recordings and browser state in ignored `.local/` folders.
- Treat OCR QA as a safety net, not proof that a recording is safe to share. Review frames manually.
- Do not use the engine to bypass sign-in controls, MFA, CAPTCHA or security warnings.
