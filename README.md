# AgeGate

[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](./LICENSE)
[![Tests](https://github.com/agecheck/agegate/actions/workflows/ci.yml/badge.svg)](https://github.com/agecheck/agegate/actions/workflows/ci.yml)

AgeGate is the browser-side integration for **AgeCheck**, a privacy-preserving age-verification authority.

AgeCheck issues cryptographically signed **age-tier credentials** (e.g., `16+`, `18+`, `21+`) without exposing a user's birthdate or identity. Users authenticate with **passkeys (WebAuthn)** and receive a verifiable credential that websites can validate server-side in milliseconds. It separates demo and production trust paths and makes verification explicit and auditable. AgeCheck is a **Derived Credential Issuer**.

Within **eIDAS 2.0**, AgeCheck functions as an **attribute attestation issuer** for age-related claims, aligned with the European Digital Identity (**EUDI**) Wallet model. It issues threshold-based age attributes (e.g., "over 18") as verifiable credentials that relying parties can validate without accessing the underlying identity data. In that ecosystem, it plays the role of a specialized attribute provider rather than a full identity wallet provider.

## Packages

This repository ships two CDN-friendly bundles under `v1/`:

- `agegate.js` / `agegate.min.js`: the production-grade flow (popup + postMessage + token decoding + optional backend verification).
- `easy-agegate.js` / `easy-agegate.min.js`: an optional UI wrapper that delegates to `launchAgeGate()` and provides a modal/button.

Both are exposed as a global `AgeCheck` when loaded via `<script>`.

### CDN URLs

These bundles are served at:

- `https://cdn.agecheck.me/agegate/v1/agegate.js`
- `https://cdn.agecheck.me/agegate/v1/agegate.min.js`
- `https://cdn.agecheck.me/agegate/v1/easy-agegate.js`
- `https://cdn.agecheck.me/agegate/v1/easy-agegate.min.js`

## Quick Start (CDN)

Add a referrer policy to prevent the relying-party URL from being sent to the issuer:

```html
<meta name="referrer" content="no-referrer" />
<script src="https://cdn.agecheck.me/agegate/v1/agegate.min.js"></script>
```

Launch an age verification popup and receive a signed credential (JWT VC) in your callback:

```html
<script>
  AgeCheck.launchAgeGate({
    include: ["session", "pidProvider", "verificationMethod", "loa"],
    onSuccess: async (jwt, payload, backendResult) => {
      // jwt: the verifiable credential (JWT)
      // payload: { agegateway_session, include, authenticationResponse }
      // backendResult: whatever your backend returns (if enabled)
      console.log("Age credential:", jwt);
    },
    onFailure: (err) => {
      console.error("AgeGate failed:", err);
    },
  });
</script>
```

## Backend Verification (Recommended)

AgeGate can call your backend to validate/audit the credential server-side. The default policy is **same-origin only**, so the safest config is a relative URL:

```js
AgeCheck.launchAgeGate({
  backendVerifyUrl: "/api/agecheck/verify",
  onSuccess: (jwt, payload, backendResult) => { /* ... */ },
});
```

To allow a cross-origin backend URL, you must opt in and provide an allowlist:

```js
AgeCheck.launchAgeGate({
  backendVerifyUrl: "https://api.example.com/agecheck/verify",
  backendVerifyAllowCrossOrigin: true,
  backendVerifyAllowedOrigins: ["https://api.example.com"],
});
```

This does **not** leak your relying-party origin to AgeCheck. The popup still talks only to `https://agecheck.me/verify.html`. Any backend verification call is initiated by your page to your backend.

## Easy AgeGate (Optional UI)

Load the UI wrapper:

```html
<meta name="referrer" content="no-referrer" />
<script src="https://cdn.agecheck.me/agegate/v1/easy-agegate.min.js"></script>
```

Render a modal (or mount a button) and run the same hardened flow:

```html
<div id="agecheck-mount"></div>
<script>
  AgeCheck.AgeGate.init({
    ui: { mount: "#agecheck-mount", buttonText: "Verify age" },
    backendVerifyUrl: "/api/agecheck/verify",
    onSuccess: (jwt) => console.log("verified", jwt),
    onFailure: (err) => console.error(err),
  });
</script>
```

You can configure and test Easy AgeGate interactively at:

- `https://demo.agegate.me/easy-agegate.html`

## Privacy + Security Notes

- Add `<meta name="referrer" content="no-referrer">` (recommended). This prevents the relying-party URL from being sent to the issuer.
- `backendVerifyUrl` is same-origin by default; cross-origin requires explicit opt-in + allowlist.
- The popup response is bounded and decoded defensively to avoid memory/CPU amplification.

## Development

```bash
pnpm install
pnpm run typecheck
pnpm run test
pnpm run build
```

Build output is written to `v1/` for CDN deployment. Sourcemaps are off by default, and `pnpm run build` removes any stale `v1/*.map` files so you do not accidentally publish them.

## License

Apache-2.0. See [`LICENSE.txt`](./LICENSE.txt), [`NOTICE.txt`](./NOTICE.txt), and [`THIRD_PARTY_NOTICES.txt`](./THIRD_PARTY_NOTICES.txt).
