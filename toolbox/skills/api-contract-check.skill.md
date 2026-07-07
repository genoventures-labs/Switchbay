---
id: api-contract-check
name: API Contract Check
description: Review API surfaces for request, response, error, auth, and compatibility issues.
languages: [typescript, python, go, ruby, sql]
agents: [backend, security, reviewer, architect]
tags: [api, backend, contract, validation]
triggers: [api, endpoint, route, schema, request, response, integration]
---

# API Contract Check

## Use When

- Adding, changing, or reviewing an API endpoint.
- Wiring a client to a server.
- Debugging mismatch between expected and actual payloads.

## Method

1. Identify the boundary: caller, callee, transport, and auth context.
2. Check required inputs, optional inputs, defaults, and type coercion.
3. Verify success responses, empty states, pagination, and status codes.
4. Verify error responses: validation, auth, rate limit, conflict, not found, and server failure.
5. Check backward compatibility and migration risk.
6. Confirm tests cover the contract, not just the happy path.

## Output

- Contract summary.
- Blocking issues first.
- Missing tests or docs.
- Suggested patch or exact next command when implementation is needed.

## Guardrails

- Never assume auth is correct because the route exists.
- Treat undocumented response shape changes as compatibility risks.
- Prefer structured validation at the boundary.
