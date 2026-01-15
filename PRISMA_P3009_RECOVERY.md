# Prisma `P3009` recovery (Managed DBs)

`P3009` means Prisma found a migration marked as **failed** in the target database, so it refuses to apply any new migrations until you resolve it.

## Fastest fix (new/empty database)

If the database has no important data yet:

1. Use **Managed Database → Settings → Reset Database** (wipes the schema / data).
2. Redeploy the project.

This clears `_prisma_migrations` along with the rest of the schema.

## Safe fix (keep data)

You need to figure out **why** the migration failed and then mark it resolved.

### 1) Get the failing migration error

Prisma stores migration failure details in the DB:

- Table: `_prisma_migrations`
- Column: `logs`

You can query it from any environment that can reach the DB.

### 2) Fix schema / fix the migration

Depending on what failed, you may need to:

- apply missing SQL changes manually, or
- revert partial changes manually, or
- create a new migration that repairs the schema.

### 3) Mark the migration as resolved

Use Prisma’s resolver:

- Mark as rolled back:
  - `npx prisma migrate resolve --rolled-back <migration_name>`
- Or mark as applied (only if the schema changes are already applied correctly):
  - `npx prisma migrate resolve --applied <migration_name>`

Then run:

- `npx prisma migrate deploy`

## Notes

- Don’t use `prisma migrate reset` in production workflows.
- `P3009` usually happens after **one migration partially applied** (bad SQL / incompatible change), or a migration failed during an earlier deploy.

