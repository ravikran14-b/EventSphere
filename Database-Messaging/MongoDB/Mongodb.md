# 01. MongoDB (`mongodb.ravi-devops.space`)

## What is MongoDB?

MongoDB is a NoSQL document database that stores data in flexible, JSON-like documents instead of traditional rows and columns.

In **EventSphere**, MongoDB stores concert details in the `events` collection and user accounts in the `users` collection because concert seating tiers, schedules, and event details can vary.

## Why Are We Creating a Separate `.repo` File?

By default, Red Hat Enterprise Linux 9 (RHEL 9) does not include MongoDB in its built-in OS package repositories.

If you run `dnf install mongodb-org` directly, Linux may return an error such as `Unable to find a match`.

Creating a `.repo` file inside `/etc/yum.repos.d/` tells the `dnf` package manager the official URL from which it can download MongoDB 7.0 packages.

## Step 1: Create the MongoDB Repository File

Create the repository configuration file using `vim`:

```bash
vim /etc/yum.repos.d/mongo.repo
```

Add the following configuration:

```ini
[mongodb-org-7.0]
name=MongoDB Repository
baseurl=https://repo.mongodb.org/yum/redhat/9/mongodb-org/7.0/x86_64/
enabled=1
gpgcheck=0
```

Save and exit by typing `:wq`.

**Note:** For production environments, enable GPG signature verification and configure MongoDB's official signing key.

## Step 2: Install MongoDB

Install the MongoDB packages:

```bash
dnf install mongodb-org -y
```

This installs the MongoDB server (`mongod`), MongoDB Shell (`mongosh`), and related database tools.

## Step 3: Enable and Start MongoDB

Enable MongoDB to start automatically whenever the server reboots:

```bash
systemctl enable mongod
```

Start the MongoDB service:

```bash
systemctl start mongod
```

Verify the service status:

```bash
systemctl status mongod --no-pager
```

The service should display `active (running)`.

## Step 4: Allow Remote Connections (`0.0.0.0`)

By default, MongoDB listens on `127.0.0.1` (localhost), which means only applications running on the same server can connect to it.

Since the EventSphere backend services (`event.ravi-devops.space` and `user.ravi-devops.space`) run on separate EC2 instances, MongoDB must listen on a network interface reachable by those services.

Edit the MongoDB configuration file:

```bash
vim /etc/mongod.conf
```

Locate the `net` section and configure it as follows:

```yaml
net:
  port: 27017
  bindIp: 0.0.0.0
```

Alternatively, replace `127.0.0.1` with `0.0.0.0` using `sed`:

```bash
sed -i 's/127.0.0.1/0.0.0.0/g' /etc/mongod.conf
```

**Security Note:** Binding to `0.0.0.0` makes MongoDB listen on all IPv4 interfaces. Restrict inbound TCP port `27017` to authorized backend servers through AWS security groups. Configure MongoDB authentication before allowing application access. Never expose the database port publicly.

## Step 5: Restart MongoDB

Restart MongoDB to apply the configuration changes:

```bash
systemctl restart mongod
```

Verify that the service is running:

```bash
systemctl status mongod --no-pager
```

## Step 6: Verify MongoDB Is Listening on Port `27017`

Run the following command:

```bash
ss -lntp | grep 27017
```

**Expected Output:**

```text
LISTEN 0 4096 0.0.0.0:27017 0.0.0.0:* users:(("mongod",pid=1842,fd=12))
```

The process ID and queue values may differ on your server.

The important part is:

```text
0.0.0.0:27017
```

This indicates that MongoDB is listening on all IPv4 interfaces.

## Step 7: Update the Route 53 DNS Record

To allow backend servers to connect to MongoDB using a domain name instead of a hardcoded IP address, create an `A` record in your AWS Route 53 hosted zone (`ravi-devops.space`).

Configure the record as follows:

| Setting | Value |
|---|---|
| Record Name | `mongodb.ravi-devops.space` |
| Record Type | `A` |
| Value | `<PRIVATE-IP-OF-MONGODB-SERVER>` |
| Routing Policy | Simple routing |

Replace `<PRIVATE-IP-OF-MONGODB-SERVER>` with the private IPv4 address of your MongoDB EC2 instance.

**Important:** Use the private IP address because the backend services communicate with MongoDB over the private network.

## Step 8: Test DNS Resolution and Connectivity

Run these commands from an authorized backend EC2 instance.

### Verify DNS Resolution

```bash
getent hosts mongodb.ravi-devops.space
```

The output should resolve the hostname to the private IP address of the MongoDB server.

### Test Port Connectivity

```bash
nc -vz mongodb.ravi-devops.space 27017
```

Successful output should indicate that the TCP connection was successful.

If the connection fails, verify the following:

- MongoDB service is running.
- MongoDB is listening on port `27017`.
- The Route 53 record points to the correct private IP.
- The MongoDB EC2 security group allows inbound TCP port `27017` from authorized backend servers.
- Network ACLs and host firewall rules allow the connection.

## MongoDB Setup Checklist

- [ ] Created the MongoDB repository file.
- [ ] Installed MongoDB packages.
- [ ] Enabled and started the `mongod` service.
- [ ] Configured MongoDB network binding.
- [ ] Restarted and verified MongoDB.
- [ ] Verified that port `27017` is listening.
- [ ] Created the Route 53 DNS record.
- [ ] Restricted network access to authorized backend servers.
- [ ] Configured MongoDB authentication.
- [ ] Verified DNS resolution and connectivity from backend instances.

## Result

MongoDB is installed and configured on the EventSphere database EC2 instance.

The backend services can use the following endpoint to connect to MongoDB over the private network, subject to network access rules and authentication.

**Database Endpoint:** `mongodb.ravi-devops.space:27017`
