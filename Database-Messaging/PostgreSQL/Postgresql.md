
# 03. PostgreSQL (`postgresql.ravi-devops.space`)

## Technology Stack

- **Technology:** PostgreSQL 16
- **Database Type:** Relational ACID Database
- **Operating System:** RHEL 9 / AlmaLinux 9 (`RedHat-9-DevOps-Practice`)
- **Hostname:** `postgresql.ravi-devops.space`
- **Port:** 5432
- **Database:** `eventsphere`
- **Application User:** `eventsphere`

## Connected Microservices

- **booking-service** (Node.js 20) — Stores customer orders, payments, and seat allocations.
- **ticket-worker** (Python 3.11 / Pika) — Reads confirmed orders, generates unique QR-code tickets, and updates ticket status to `ISSUED`.

## What Is PostgreSQL?

PostgreSQL is an open-source relational database that supports SQL and ACID transactions.

In EventSphere, PostgreSQL stores financial orders and ticket records. Transactions help maintain data consistency when bookings and payments are processed. If a transaction fails, PostgreSQL can roll back its changes.

## Why Configure Remote Access?

Because `booking-service` and `ticket-worker` run on separate EC2 instances, PostgreSQL must be configured to:

1. Listen on the appropriate network interface.
2. Allow connections from authorized application servers.
3. Authenticate clients using `scram-sha-256`.
4. Restrict network access through AWS Security Groups.

## Step 1: Enable PostgreSQL 16 Module

Check available PostgreSQL module streams:

```bash
dnf module list postgresql
```

If PostgreSQL 16 is available:

```bash
dnf module disable postgresql -y
dnf module enable postgresql:16 -y
```

> Note: Module availability differs between RHEL 9 and AlmaLinux 9 configurations. Verify that PostgreSQL 16 is available in your configured repositories.

## Step 2: Install PostgreSQL Server

```bash
dnf install postgresql-server -y
```

## Step 3: Initialize the Database Cluster

Initialize the database cluster before starting PostgreSQL for the first time.

```bash
postgresql-setup --initdb
```

Expected output may resemble:

```text
 * Initializing database in '/var/lib/pgsql/data'...
 * Initialized, logs are in /var/lib/pgsql/initdb_postgresql.log
```

> Run initialization only if the database cluster has not already been initialized. Do not reinitialize an existing database because it can cause data loss.

## Step 4: Configure Remote Listening

Back up the configuration:

```bash
cp /var/lib/pgsql/data/postgresql.conf \
   /var/lib/pgsql/data/postgresql.conf.bak
```

Edit the configuration:

```bash
vi /var/lib/pgsql/data/postgresql.conf
```

Set:

```conf
listen_addresses = '*'
```

Verify:

```bash
grep -E '^[[:space:]]*listen_addresses' \
  /var/lib/pgsql/data/postgresql.conf
```

Expected output:

```text
listen_addresses = '*'
```

## Step 5: Configure Client Authentication

Back up the authentication file:

```bash
cp /var/lib/pgsql/data/pg_hba.conf \
   /var/lib/pgsql/data/pg_hba.conf.bak
```

Edit the file:

```bash
vi /var/lib/pgsql/data/pg_hba.conf
```

Add a rule for your actual VPC CIDR. Example for `172.31.0.0/16`:

```conf
host    eventsphere    eventsphere    172.31.0.0/16    scram-sha-256
```

Replace the example CIDR with your actual VPC network.

> Avoid `0.0.0.0/0`. Restrict database access to trusted networks and authorized clients.

## Step 6: Enable and Start PostgreSQL

```bash
systemctl enable postgresql
systemctl start postgresql
```

Verify the service:

```bash
systemctl status postgresql --no-pager
```

If it fails to start:

```bash
journalctl -u postgresql --no-pager -n 100
```

## Step 7: Create the Database and Application User

### Database Details

- **Database:** `eventsphere`
- **Username:** `eventsphere`
- **Password:** Use a strong, securely stored password.

Open the PostgreSQL prompt:

```bash
sudo -u postgres psql
```

Execute:

```sql
CREATE USER eventsphere WITH LOGIN;
\password eventsphere
CREATE DATABASE eventsphere OWNER eventsphere;
\q
```

The `\password` command prompts you to enter the password.

If the user or database already exists, inspect the existing objects instead of repeating the creation commands blindly.

## Step 8: Verify Port 5432

Check service status:

```bash
systemctl status postgresql --no-pager
```

Check the listening port:

```bash
ss -lntp | grep 5432
```

Example output:

```text
LISTEN 0 244 0.0.0.0:5432 0.0.0.0:* users:(("postgres",pid=3210,fd=7))
```

### Test Database Authentication

```bash
psql -h 127.0.0.1 -U eventsphere -d eventsphere
```

Enter the password when prompted, then execute:

```sql
SELECT current_database(), current_user;
```

Expected result:

```text
 current_database | current_user
------------------+--------------
 eventsphere      | eventsphere
(1 row)
```

Exit:

```sql
\q
```

## Step 9: Configure Route 53

Create an `A` record in the appropriate private hosted zone.

| Setting | Value |
|---|---|
| Record name | `postgresql.ravi-devops.space` |
| Record type | `A` |
| Value | `<PRIVATE-IP-OF-POSTGRESQL-SERVER>` |
| Hosted zone | Private hosted zone associated with the VPC |

## Step 10: Configure AWS Security Group

Add an inbound rule to the PostgreSQL EC2 instance's Security Group.

| Setting | Value |
|---|---|
| Type | Custom TCP |
| Protocol | TCP |
| Port | 5432 |
| Source | `booking-service` and `ticket-worker` Security Groups |

Do not expose PostgreSQL to the public internet.

## Step 11: Test Connectivity from Application Servers

Run these commands from the booking-service and ticket-worker EC2 instances.

Verify DNS:

```bash
getent hosts postgresql.ravi-devops.space
```

Test TCP connectivity:

```bash
nc -vz -w 5 postgresql.ravi-devops.space 5432
```

Test database authentication:

```bash
psql -h postgresql.ravi-devops.space \
     -U eventsphere \
     -d eventsphere \
     -W \
     -c "SELECT current_database(), current_user;"
```

## Step 12: Troubleshooting

### PostgreSQL service is inactive

```bash
systemctl status postgresql --no-pager
journalctl -u postgresql --no-pager -n 100
```

### Port 5432 is not listening

```bash
ss -lntp | grep 5432
```

Verify `listen_addresses` and restart PostgreSQL if required:

```bash
systemctl restart postgresql
```

### Connection timeout

Check:

- PostgreSQL Security Group inbound rules.
- Application server Security Groups.
- VPC routing and network ACLs.
- DNS resolution.
- PostgreSQL service status.

### Connection refused

Verify that PostgreSQL is running and listening on the expected private IP and port.

### Password authentication failed

Check the username, password, database name, and matching `pg_hba.conf` rules.

### Ident authentication failed

Verify that the connection matches the intended authentication rule and that `scram-sha-256` is configured for password-based connections.

## Step 13: Final Validation

Run on the PostgreSQL server:

```bash
systemctl is-enabled postgresql
systemctl is-active postgresql
ss -lntp | grep 5432
```

Test the database:

```bash
psql -h 127.0.0.1 \
     -U eventsphere \
     -d eventsphere \
     -W \
     -c "SELECT current_database(), current_user;"
```

Run from each application server:

```bash
getent hosts postgresql.ravi-devops.space
nc -vz -w 5 postgresql.ravi-devops.space 5432
```

## Database Tables

The `bookings` and `tickets` tables will be created when the booking-service and ticket-worker database schemas are configured.

These tables will support transactional order processing, seat allocation, ticket generation, and ticket status management.

---

**PostgreSQL's role in EventSphere:** Reliable transactional storage for bookings, payments, seat allocations, and issued tickets.

