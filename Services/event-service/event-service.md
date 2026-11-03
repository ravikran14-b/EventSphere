# 05. Event Service (`event.ravi-devops.space`)

* **Technology & Version:** Node.js **20.x** (Express Framework)
* **Operating System:** RHEL 9 / AlmaLinux 9 (`RedHat-9-DevOps-Practice`)
* **Connected Database:** `mongodb.ravi-devops.space:27017`[cite: 1]
* **Listening Port:** `8080`[cite: 1]

---

### What is the Event Service?
The `event-service` manages concert listings, artist lineups, venue seating tiers, and live available seat counts. It connects to MongoDB to read event details for the frontend and decrement seat inventory when a user completes a booking.

### Why do we create the `eventsphere` system user and `/app` directory?
Running web services as the `root` user is a security risk—if the service is compromised, the attacker gets full control of the server. Creating a dedicated, non-login system user (`eventsphere`) and isolating the code inside `/app` ensures the service runs with minimal permissions.

---

### Step 1: Enable and Install Node.js 20
By default, RHEL 9 disables newer Node.js versions in its module streams. We disable the default stream, enable Node.js 20, and install it.

```bash
dnf module disable nodejs -y
dnf module enable nodejs:20 -y
dnf install nodejs -y
```

---

### Step 2: Create the `eventsphere` System User and `/app` Directory
We create a system user without a login shell (`/sbin/nologin`) and create the `/app` directory where our application code will live.

```bash
id eventsphere &>/dev/null || useradd --system --home /app --shell /sbin/nologin eventsphere
mkdir -p /app
```

---

### Step 3: Download the Application Code from GitHub
We download the repository archive into `/tmp`, extract it, and copy the `event-service` source files from `Services/event-service/` into `/app`.

```bash
curl -L -o /tmp/event.zip [https://github.com/ravikran14-b/EventSphere/archive/refs/heads/main.zip](https://github.com/ravikran14-b/EventSphere/archive/refs/heads/main.zip)
unzip -o /tmp/event.zip -d /tmp/
cp -r /tmp/EventSphere-main/Services/event-service/* /app/
chown -R eventsphere:eventsphere /app
```

---

### Step 4: Install Node.js Dependencies
We navigate to `/app` and run `npm install` to download the required packages (`express`, `mongodb`, `cors`, `dotenv`) defined in `package.json`.

```bash
cd /app
npm install --omit=dev
```

---

### Step 5: Configure the Systemd Service (`event.service`)
We create `/etc/systemd/system/event.service` so Linux manages our Node.js app in the background, starts it on boot, and restarts it automatically if it crashes.

```bash
cat << 'EOF' > /etc/systemd/system/event.service
[Unit]
Description=EventSphere Event Catalog Service
After=network.target

[Service]
Type=simple
User=eventsphere
WorkingDirectory=/app
Environment=PORT=8080
Environment=MONGO_URL=mongodb://mongodb.ravi-devops.space:27017
Environment=DB_NAME=eventsphere
ExecStart=/usr/bin/node /app/server.js
Restart=always
RestartSec=10
StandardOutput=syslog
StandardError=syslog
SyslogIdentifier=eventsphere-event

[Install]
WantedBy=multi-user.target
EOF
```

---

### Step 6: Load the Master Data into MongoDB
Since `event-service` owns the concert catalog schema, we install the MongoDB client (`mongodb-mongosh`) on this server and load `Master-data.js` into `mongodb.ravi-devops.space`.

```bash
rm -f /etc/yum.repos.d/mongo.repo && printf "[mongodb-org-7.0]\nname=MongoDB Repository\nbaseurl=[https://repo.mongodb.org/yum/redhat/9/mongodb-org/7.0/x86_64/](https://repo.mongodb.org/yum/redhat/9/mongodb-org/7.0/x86_64/)\ngpgcheck=1\nenabled=1\ngpgkey=[https://pgp.mongodb.com/server-7.0.asc](https://pgp.mongodb.com/server-7.0.asc)\n" > /etc/yum.repos.d/mongo.repo
dnf install mongodb-mongosh -y
mongosh --host mongodb.ravi-devops.space </tmp/EventSphere-main/Database-Messaging/MongoDB/Master-data.js
```

---

### Step 7: Start and Verify the Event Service
We reload `systemd` to detect our new service file, enable and start `event`, and test both the `/health` and `/api/events` endpoints on port `8080`.

```bash
systemctl daemon-reload
systemctl enable event
systemctl start event
systemctl status event --no-pager
ss -lntp | grep 8080
curl -s http://localhost:8080/health
```

**Expected Output:**
```json
{"status":"UP","service":"event-service","database":"connected"}
```

---

### Step 8: Update Route53 Record & Security Group
* **Route53 Record Name:** `event.ravi-devops.space`
* **Type:** `A`
* **Value:** `<Private-IP-of-event-server>`
* **Security Group:** Allow inbound TCP `8080` from `frontend` and `booking` security groups[cite: 1].
