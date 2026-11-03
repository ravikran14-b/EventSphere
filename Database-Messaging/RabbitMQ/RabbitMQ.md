
# 04. RabbitMQ (`rabbitmq.ravi-devops.space`)

## Technology Stack

- **Technology:** RabbitMQ 3.13
- **Runtime:** Erlang 26
- **Operating System:** RHEL 9 / AlmaLinux 9 (`RedHat-9-DevOps-Practice`)
- **Hostname:** `rabbitmq.ravi-devops.space`
- **AMQP Port:** 5672
- **Management UI Port:** 15672

## Connected Microservices

- **booking-service** (Node.js 20) — Publishes `booking.paid` events after a booking transaction completes.
- **ticket-worker** (Python 3.11 / Pika) — Consumes messages asynchronously to generate QR tickets and dispatch confirmations.

## What Is RabbitMQ?

RabbitMQ is a message broker that supports AMQP (Advanced Message Queuing Protocol).

In EventSphere, RabbitMQ decouples payment processing from ticket generation. After a booking is completed, `booking-service` publishes an event to RabbitMQ. The `ticket-worker` processes that event asynchronously to generate tickets.

This architecture reduces direct dependencies between microservices and allows background jobs to be processed independently.

## Why Configure Erlang and RabbitMQ Repositories?

RabbitMQ depends on the Erlang runtime. Compatible Erlang and RabbitMQ versions must be installed together.

External package repositories can provide compatible versions when the required packages are unavailable in the operating system's default repositories.

> **Important:** RabbitMQ 3.13 and Erlang 26 are version-specific requirements. Confirm package availability and compatibility before installation. RabbitMQ 3.13 is an older release, so use a supported release for production deployments.

## Step 1: Add Erlang and RabbitMQ Repositories

Install `curl` if it is not already available:

```bash
dnf install curl -y
```

Add the Erlang repository:

```bash
curl -fsSL https://packagecloud.io/install/repositories/rabbitmq/erlang/script.rpm.sh -o /tmp/erlang-repo.sh
less /tmp/erlang-repo.sh
bash /tmp/erlang-repo.sh
```

Add the RabbitMQ server repository:

```bash
curl -fsSL https://packagecloud.io/install/repositories/rabbitmq/rabbitmq-server/script.rpm.sh -o /tmp/rabbitmq-repo.sh
less /tmp/rabbitmq-repo.sh
bash /tmp/rabbitmq-repo.sh
```

Refresh package metadata:

```bash
dnf makecache
```

> Review repository installation scripts before executing them. Verify that the repositories provide the intended RabbitMQ and Erlang versions for your OS.

## Step 2: Install RabbitMQ Server

Install RabbitMQ:

```bash
dnf install rabbitmq-server -y
```

Check the installed package version:

```bash
rpm -q rabbitmq-server
```

Check the Erlang runtime:

```bash
erl -eval 'erlang:display(erlang:system_info(otp_release)), halt().' -noshell
```

Verify that the installed Erlang release is compatible with your RabbitMQ version.

## Step 3: Enable and Start RabbitMQ

Enable RabbitMQ at boot and start it:

```bash
systemctl enable rabbitmq-server
systemctl start rabbitmq-server
```

Verify the service:

```bash
systemctl status rabbitmq-server --no-pager
```

If RabbitMQ fails to start, inspect the logs:

```bash
journalctl -u rabbitmq-server --no-pager -n 100
```

## Step 4: Enable RabbitMQ Management Plugin

Enable the management plugin:

```bash
rabbitmq-plugins enable rabbitmq_management
```

Check enabled plugins:

```bash
rabbitmq-plugins list -e
```

The management interface normally listens on port `15672`.

Use the management interface to inspect queues, exchanges, message rates, and connected consumers.

## Step 5: Create the Application User

Create a dedicated application user and enter the password interactively:

```bash
rabbitmqctl add_user eventsphere
```

Set administrator privileges only if this account genuinely requires administrative access:

```bash
rabbitmqctl set_user_tags eventsphere administrator
```

For application access, a dedicated non-administrator user is preferable.

Grant permissions on the default virtual host `/`:

```bash
rabbitmqctl set_permissions -p / eventsphere ".*" ".*" ".*"
```

The three permission patterns control configure, write, and read access, respectively.

> **Security:** Do not store application passwords in GitHub. Use a strong password managed through a secure secrets mechanism. Restrict application permissions to the required virtual hosts and resources wherever possible.

### Verify the User and Permissions

```bash
rabbitmqctl list_users
rabbitmqctl list_permissions -p /
```

## Step 6: Verify Service Status and Listening Ports

Check RabbitMQ:

```bash
systemctl status rabbitmq-server --no-pager
```

Check the AMQP and management ports:

```bash
ss -lntp | grep -E '5672|15672'
```

Example output:

```text
LISTEN 0 128 0.0.0.0:15672 0.0.0.0:* users:(("beam.smp",pid=4102,fd=34))
LISTEN 0 128 0.0.0.0:5672 0.0.0.0:* users:(("beam.smp",pid=4102,fd=33))
```

The exact output depends on your server configuration.

Check RabbitMQ health:

```bash
rabbitmq-diagnostics ping
rabbitmq-diagnostics check_running
```

## Step 7: Configure Route 53

Create an `A` record in the private hosted zone associated with your VPC.

| Setting | Value |
|---|---|
| Record name | `rabbitmq.ravi-devops.space` |
| Record type | `A` |
| Value | `<PRIVATE-IP-OF-RABBITMQ-SERVER>` |
| Hosted zone | Private hosted zone |

This allows `booking-service` and `ticket-worker` to resolve RabbitMQ using its private DNS name.

## Step 8: Configure AWS Security Groups

Configure inbound rules on the RabbitMQ EC2 instance.

### AMQP Access

| Setting | Value |
|---|---|
| Protocol | TCP |
| Port | 5672 |
| Source | `booking-service` and `ticket-worker` Security Groups |

### Management UI Access

| Setting | Value |
|---|---|
| Protocol | TCP |
| Port | 15672 |
| Source | Trusted administrative IP or administrative Security Group |

Do not expose the management UI or AMQP port to the public internet.

## Step 9: Test Connectivity from Application Servers

Run these commands from the booking-service and ticket-worker instances.

Verify DNS:

```bash
getent hosts rabbitmq.ravi-devops.space
```

Test AMQP connectivity:

```bash
nc -vz -w 5 rabbitmq.ravi-devops.space 5672
```

Test management UI connectivity if administrative access is permitted:

```bash
nc -vz -w 5 rabbitmq.ravi-devops.space 15672
```

A successful TCP test confirms network connectivity, but it does not verify application authentication or message delivery.

## Step 10: Troubleshooting

### RabbitMQ service is inactive

```bash
systemctl status rabbitmq-server --no-pager
journalctl -u rabbitmq-server --no-pager -n 100
```

### RabbitMQ is not listening on port 5672

```bash
ss -lntp | grep 5672
rabbitmq-diagnostics ping
```

### DNS resolution failure

```bash
getent hosts rabbitmq.ravi-devops.space
```

Check the private hosted zone and VPC association.

### Connection timeout

Check:

- AWS Security Group inbound rules.
- Source Security Groups.
- VPC routing and network ACLs.
- DNS resolution.
- RabbitMQ service status.

### Authentication failure

Verify the username, password, virtual host, and assigned permissions.

```bash
rabbitmqctl list_users
rabbitmqctl list_permissions -p /
```

### Messages are not reaching ticket-worker

Check queue bindings, exchanges, routing keys, consumer status, and worker logs.

```bash
rabbitmqctl list_queues name messages consumers
rabbitmqctl list_exchanges name type
rabbitmqctl list_bindings
```

For reliable ticket processing, configure durable queues, persistent messages where appropriate, publisher confirms, manual consumer acknowledgements, and retry/dead-letter handling. Make ticket creation idempotent to avoid duplicate tickets when messages are redelivered.

## Step 11: Final Validation

Run on the RabbitMQ server:

```bash
systemctl is-enabled rabbitmq-server
systemctl is-active rabbitmq-server
rabbitmq-diagnostics ping
rabbitmqctl list_queues name messages consumers
ss -lntp | grep -E '5672|15672'
```

Run from application servers:

```bash
getent hosts rabbitmq.ravi-devops.space
nc -vz -w 5 rabbitmq.ravi-devops.space 5672
```

## RabbitMQ's Role in EventSphere

RabbitMQ supports:

- Asynchronous booking event processing.
- Decoupling payment and ticket-generation workflows.
- Background QR ticket generation.
- Communication between booking-service and ticket-worker.
- Reliable message delivery when queues, acknowledgements, retries, and persistence are configured appropriately.

---

**RabbitMQ's role in EventSphere:** Message-based communication between booking and ticket-generation microservices.
