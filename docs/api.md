# API

All authenticated endpoints expect a Supabase access token in `Authorization: Bearer <token>`.

## Auth

- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `POST /api/auth/change-password`
- `GET /api/auth/me`

## Users

- `GET /api/users/me`
- `PATCH /api/users/me`

## Wallets

- `POST /api/wallets/import`
- `POST /api/wallets/bulk-import`
- `POST /api/wallets/create`
- `GET /api/wallets`
- `GET /api/wallets/:id`
- `GET /api/wallets/:id/balance`
- `PATCH /api/wallets/:id`
- `DELETE /api/wallets/:id`

## Collections

- `POST /api/collections/scan`
- `POST /api/collections/check-eligibility`

## Execution

- `POST /api/wallet-health/run`
- `POST /api/funding/calculate`
- `POST /api/funding/create-plan`
- `POST /api/funding/execute`
- `POST /api/simulation/run`
- `POST /api/readiness/calculate`
- `POST /api/mint-tasks`
- `GET /api/mint-tasks`
- `GET /api/mint-tasks/:id`
- `POST /api/mint-tasks/:id/schedule`
- `POST /api/mint-tasks/:id/cancel`

## Reports and RPC

- `GET /api/reports/:taskId`
- `GET /api/reports/:taskId/export-csv`
- `GET /api/rpc/health`
- `POST /api/rpc/endpoints`
- `POST /api/rpc/endpoints/:id/test`

## Socket.IO Events

- `task.status.updated`
- `task.log.created`
- `transaction.updated`
- `rpc.health.updated`
- `report.generated`
