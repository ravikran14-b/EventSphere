
# 02. Redis (`redis.ravi-devops.space`)

## Technology Stack

- **Technology / Version:** Redis 7.0
- **OS:** RHEL 9 / AlmaLinux 9 (`RedHat-9-DevOps-Practice`)
- **Port:** 6379
- **Hostname:** `redis.ravi-devops.space`

## Connected Microservices

- **user-service** (Node.js 20) — Caches active user sessions and tokens.
- **reservation-service** (Python 3.11 / FastAPI) — Creates temporary 10-minute seat locks using TTL.
- **booking-service** (Node.js 20) — Verifies seat locks and removes them after successful payment.

## What Is Redis?

Redis is an in-memory key-value data store that provides very low-latency data access.

In EventSphere, Redis locks concert seats for 10 minutes (600 seconds) when a user starts checkout. If payment is not completed before the lock expires, Redis automatically removes the lock using TTL (Time To Live).

### Example: Create a Seat Lock

```bash
# Create a seat lock for 600 seconds
redis-cli SET seat:concert-123:A10 user-456 NX EX 600

# Check remaining lock time
redis-cli TTL seat:concert-123:A10

# Retrieve lock owner
redis-cli GET seat:concert-123:A10
```

- `NX` prevents overwriting an existing key.
- `EX 600` expires the key after 600 seconds.

## Step 1: Enable Redis 7 Module

Check available Redis module streams:

```bash
dnf module list redis
```

If Redis 7 is available on your configured repositories:

```bash
dnf module disable redis -y
dnf module enable redis:7 -y
```

> Note: Module availability differs between RHEL and AlmaLinux releases.

## Step 2: Install Redis

```bash
dnf install redis -y
```

Verify the installed version:

```bash
redis-server --version
```

## Step 3: Configure Redis Network Access

Back up the configuration:

```bash
cp /etc/redis/redis.conf /etc/redis/redis.conf.bak
```

Edit the configuration:

```bash
vi /etc/redis/redis.conf
```

Configure the following settings, replacing `<REDIS_PRIVATE_IP>` with the Redis server's actual private IP:

```conf
bind 127.0.0.1 <REDIS_PRIVATE_IP>
protected-mode yes
```

Configure Redis authentication or ACLs before allowing application servers to connect.

**Security:** Do not expose Redis to the public internet. Use a private IP, authentication, and restrictive AWS Security Group rules.

Verify the configuration:

```bash
grep -E '^(bind|protected-mode|port)' /etc/redis/redis.conf
```

## Step 4: Enable and Start Redis

```bash
systemctl enable redis
systemctl start redis
```

Check service status:

```bash
systemctl status redis --no-pager
```

Check logs if Redis fails to start:

```bash
journalctl -u redis --no-pager -n 100
```

## Step 5: Verify Redis on Port 6379

Check the listening port:

```bash
ss -lntp | grep 6379
```

Test Redis locally:

```bash
redis-cli ping
```

Expected output:

```text
PONG
```

If authentication is enabled, authenticate using your configured Redis ACL credentials before running commands.

## Step 6: Configure Route 53

Create a DNS record in the private hosted zone associated with your VPC.

| Setting | Value |
|---|---|
| Record name | `redis.ravi-devops.space` |
| Record type | `A` |
| Value | `<PRIVATE-IP-OF-REDIS-SERVER>` |
| Hosted zone | Private hosted zone |

## Step 7: Configure AWS Security Group

Add an inbound rule to the Redis EC2 instance's Security Group.

| Setting | Value |
|---|---|
| Type | Custom TCP |
| Protocol | TCP |
| Port | 6379 |
| Source | Security Groups of user, reservation, and booking services |

Do not allow `0.0.0.0/0` on port 6379.

## Step 8: Test Connectivity from Application Servers

Run these commands from the user, reservation, and booking EC2 instances:

```bash
# Verify DNS resolution
getent hosts redis.ravi-devops.space

# Test TCP connectivity
nc -vz -w 5 redis.ravi-devops.space 6379
```

A successful TCP connection confirms network reachability, but not successful Redis authentication.

## Step 9: Troubleshooting

### Redis service is not running

```bash
systemctl status redis --no-pager
journalctl -u redis --no-pager -n 100
```

### Redis is not listening on port 6379

```bash
ss -lntp | grep 6379
```

### DNS resolution failure

```bash
getent hosts redis.ravi-devops.space
```

### Connection timeout

Check:

- Redis private IP and port.
- AWS Security Group inbound rules.
- Application server Security Groups.
- VPC routing and network ACLs.
- Redis service status.

### Connection refused

Check whether Redis is running and listening on the expected private IP.

## Final Validation

Run on the Redis server:

```bash
systemctl is-enabled redis
systemctl is-active redis
redis-cli ping
ss -lntp | grep 6379
```

Run from each application server:

```bash
getent hosts redis.ravi-devops.space
nc -vz -w 5 redis.ravi-devops.space 6379
```

## Redis Role in EventSphere

Redis provides:

- User session caching.
- Temporary concert seat reservations.
- Automatic lock expiration using TTL.
- Coordination between reservation and booking services.
