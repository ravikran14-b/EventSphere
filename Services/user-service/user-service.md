
# EventSphere — User Service

## 1. Service Overview

The User Service handles user registration, login, authentication, and session management.

| Property | Details |
|---|---|
| Service Name | User Service |
| Domain | `user.ravi-devops.space` |
| Technology | Node.js 20.x, Express.js |
| Operating System | RHEL 9 / AlmaLinux 9 |
| Application Port | 8080 |
| Database | MongoDB |
| Session Store | Redis |

### Dependencies

**Upstream dependencies**

- MongoDB: `mongodb.ravi-devops.space:27017`
- Redis: `redis.ravi-devops.space:6379`

**Downstream consumers**

- Frontend Service
- Reservation Service
- Booking Service

### Responsibilities

- Register new users.
- Store user profiles in MongoDB.
- Hash passwords using bcrypt.
- Authenticate users during login.
- Generate secure session tokens.
- Store sessions in Redis with a 24-hour TTL.
- Verify authentication tokens.

---

## 2. GitHub Repository Structure

Create the following files:

```text
Services/
└── user-service/
    ├── README.md
    ├── package.json
    ├── server.js
    └── .env.example
```

---

## 3. Application Code

### 3.1 package.json

Create `Services/user-service/package.json`.

```json
{
  "name": "user-service",
  "version": "1.0.0",
  "description": "EventSphere User Registration & Authentication Microservice",
  "main": "server.js",
  "scripts": {
    "start": "node server.js"
  },
  "dependencies": {
    "bcryptjs": "^2.4.3",
    "cors": "^2.8.5",
    "express": "^4.19.2",
    "mongodb": "^6.5.0",
    "redis": "^4.6.13"
  }
}
```

> Note: Node.js provides the `crypto` module natively, so it does not need to be installed separately.

### 3.2 server.js

Create `Services/user-service/server.js`.

```javascript
const express = require('express');
const { MongoClient } = require('mongodb');
const { createClient } = require('redis');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const cors = require('cors');

const app = express();

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 8080;

const MONGO_URL =
  process.env.MONGO_URL ||
  'mongodb://mongodb.ravi-devops.space:27017';

const REDIS_HOST =
  process.env.REDIS_HOST || 'redis.ravi-devops.space';

const REDIS_PORT = process.env.REDIS_PORT || 6379;

const DB_NAME = process.env.DB_NAME || 'eventsphere';

let db = null;
let redisClient = null;

async function initClients() {
  try {
    const mongoClient = new MongoClient(MONGO_URL, {
      connectTimeoutMS: 5000
    });

    await mongoClient.connect();

    db = mongoClient.db(DB_NAME);

    console.log(
      `[user-service] Connected to MongoDB at ${MONGO_URL}`
    );

    redisClient = createClient({
      url: `redis://${REDIS_HOST}:${REDIS_PORT}`
    });

    redisClient.on('error', (err) => {
      console.error(
        '[user-service] Redis Client Error:',
        err.message
      );
    });

    await redisClient.connect();

    console.log(
      `[user-service] Connected to Redis at ${REDIS_HOST}:${REDIS_PORT}`
    );
  } catch (err) {
    console.error(
      `[user-service] Startup failure: ${err.message}`
    );

    process.exit(1);
  }
}

// Health Check
app.get('/health', async (req, res) => {
  try {
    await db.command({ ping: 1 });

    const redisPing = await redisClient.ping();

    res.status(200).json({
      status: 'UP',
      service: 'user-service',
      mongodb: 'connected',
      redis: redisPing === 'PONG' ? 'connected' : 'degraded'
    });
  } catch (err) {
    res.status(503).json({
      status: 'DOWN',
      error: 'A required dependency is unavailable'
    });
  }
});

// User Registration
app.post('/api/users/register', async (req, res) => {
  const { username, email, password, fullName } = req.body;

  if (!username || !email || !password) {
    return res.status(400).json({
      error: 'Username, email, and password are required'
    });
  }

  try {
    const existing = await db.collection('users').findOne({
      $or: [{ email }, { username }]
    });

    if (existing) {
      return res.status(409).json({
        error: 'User with this email or username already exists'
      });
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    const userId =
      `USR-${Date.now().toString(36).toUpperCase()}`;

    await db.collection('users').insertOne({
      userId,
      username,
      email,
      fullName: fullName || username,
      passwordHash,
      createdAt: new Date()
    });

    res.status(201).json({
      message: 'User registered successfully',
      userId,
      username
    });
  } catch (err) {
    console.error('[user-service] Registration error:', err);

    res.status(500).json({
      error: 'Registration failed'
    });
  }
});

// User Login
app.post('/api/users/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({
      error: 'Email and password are required'
    });
  }

  try {
    const user = await db.collection('users').findOne({ email });

    if (!user) {
      return res.status(401).json({
        error: 'Invalid email or password'
      });
    }

    const isMatch = await bcrypt.compare(
      password,
      user.passwordHash
    );

    if (!isMatch) {
      return res.status(401).json({
        error: 'Invalid email or password'
      });
    }

    const token = crypto.randomBytes(32).toString('hex');

    const sessionData = {
      userId: user.userId,
      username: user.username,
      email: user.email,
      fullName: user.fullName
    };

    await redisClient.setEx(
      `session:${token}`,
      86400,
      JSON.stringify(sessionData)
    );

    res.status(200).json({
      message: 'Login successful',
      token,
      user: sessionData
    });
  } catch (err) {
    console.error('[user-service] Login error:', err);

    res.status(500).json({
      error: 'Login failed'
    });
  }
});

// Verify Authentication Token
app.get('/api/users/verify', async (req, res) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      valid: false,
      error: 'Missing or malformed Authorization header'
    });
  }

  const token = authHeader.split(' ')[1];

  try {
    const cachedSession = await redisClient.get(
      `session:${token}`
    );

    if (!cachedSession) {
      return res.status(401).json({
        valid: false,
        error: 'Session expired or invalid'
      });
    }

    res.status(200).json({
      valid: true,
      user: JSON.parse(cachedSession)
    });
  } catch (err) {
    console.error('[user-service] Token verification error:', err);

    res.status(500).json({
      valid: false,
      error: 'Token verification failed'
    });
  }
});

// Start application after connecting to dependencies
initClients().then(() => {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(
      `[user-service] Listening on port ${PORT}`
    );
  });
});
```

### 3.3 .env.example

Create `Services/user-service/.env.example`.

```dotenv
PORT=8080
MONGO_URL=mongodb://mongodb.ravi-devops.space:27017
REDIS_HOST=redis.ravi-devops.space
REDIS_PORT=6379
DB_NAME=eventsphere
```

---

## 4. Deploy User Service on EC2

Connect to the User Service EC2 instance using SSH.

### Step 1: Install Node.js 20

```bash
sudo dnf module disable nodejs -y
sudo dnf module enable nodejs:20 -y
sudo dnf install nodejs unzip curl -y
```

Verify the installation:

```bash
node --version
npm --version
```

### Step 2: Create a Service User

```bash
id eventsphere &>/dev/null || \
sudo useradd --system --home /app --shell /sbin/nologin eventsphere

sudo mkdir -p /app
```

### Step 3: Download Application Code

```bash
cd /tmp

curl -L -o user.zip \
https://github.com/ravikran14-b/EventSphere/archive/refs/heads/main.zip

unzip -o user.zip -d /tmp/

sudo cp -r \
/tmp/EventSphere-main/Services/user-service/. \
/app/

sudo chown -R eventsphere:eventsphere /app
```

### Step 4: Install Dependencies

```bash
cd /app

sudo npm install --omit=dev
```

Verify the application files:

```bash
ls -la /app
```

Expected files include:

```text
package.json
server.js
node_modules/
```

---

## 5. Configure systemd

Create the service unit:

```bash
sudo vi /etc/systemd/system/user.service
```

Add the following configuration:

```ini
[Unit]
Description=EventSphere User and Authentication Service
After=network.target

[Service]
Type=simple
User=eventsphere
WorkingDirectory=/app

Environment=PORT=8080
Environment=MONGO_URL=mongodb://mongodb.ravi-devops.space:27017
Environment=REDIS_HOST=redis.ravi-devops.space
Environment=REDIS_PORT=6379
Environment=DB_NAME=eventsphere

ExecStart=/usr/bin/node /app/server.js

Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

Save the file and exit.

Reload systemd and start the service:

```bash
sudo systemctl daemon-reload
sudo systemctl enable user
sudo systemctl start user
```

Check the service status:

```bash
sudo systemctl status user --no-pager
```

View live logs:

```bash
sudo journalctl -u user -f
```

View recent logs:

```bash
sudo journalctl -u user -n 100 --no-pager
```

---

## 6. Validate the Application

### Check Port 8080

```bash
sudo ss -lntp | grep ':8080'
```

### Test the Health Endpoint

```bash
curl -i http://localhost:8080/health
```

Expected response when both dependencies are reachable:

```json
{
  "status": "UP",
  "service": "user-service",
  "mongodb": "connected",
  "redis": "connected"
}
```

### Test User Registration

```bash
curl -X POST http://localhost:8080/api/users/register \
-H "Content-Type: application/json" \
-d '{
  "username": "ravi",
  "email": "ravi@example.com",
  "password": "ChangeThisPassword123!",
  "fullName": "Ravi Kiran"
}'
```

### Test User Login

```bash
curl -X POST http://localhost:8080/api/users/login \
-H "Content-Type: application/json" \
-d '{
  "email": "ravi@example.com",
  "password": "ChangeThisPassword123!"
}'
```

The response includes a session token. Use the returned token in the next request.

### Test Token Verification

Replace `YOUR_TOKEN` with the token returned by the login endpoint.

```bash
curl http://localhost:8080/api/users/verify \
-H "Authorization: Bearer YOUR_TOKEN"
```

A valid session returns `"valid": true`.

---

## 7. Route 53 Configuration

Create a private DNS record in the Route 53 hosted zone used by your internal services.

| Setting | Value |
|---|---|
| Record name | `user.ravi-devops.space` |
| Record type | A |
| Value | Private IP of the User Service EC2 instance |
| Routing policy | Simple |
| TTL | 30–60 seconds |

Validate DNS resolution from an instance in the same VPC:

```bash
nslookup user.ravi-devops.space
```

Or:

```bash
dig +short user.ravi-devops.space
```

The returned address should match the User Service instance's private IP.

---

## 8. AWS Security Group Rules

Configure inbound and outbound rules using the actual Security Group IDs in your environment.

### Inbound Rules

| Protocol | Port | Source |
|---|---:|---|
| TCP | 8080 | Frontend Service Security Group |
| TCP | 8080 | Reservation Service Security Group |
| TCP | 8080 | Booking Service Security Group |

Only add consumers that actually call the User Service.

### Outbound Rules

| Protocol | Port | Destination |
|---|---:|---|
| TCP | 27017 | MongoDB Security Group |
| TCP | 6379 | Redis Security Group |
| TCP | 443 | Required HTTPS endpoints, if applicable |

Prefer referencing destination Security Groups rather than allowing unrestricted access. Confirm that the MongoDB and Redis Security Groups also allow inbound traffic from the User Service Security Group.

---

## 9. Troubleshooting

### Service Is Not Starting

```bash
sudo systemctl status user --no-pager
sudo journalctl -u user -n 100 --no-pager
```

### Port 8080 Is Not Listening

```bash
sudo ss -lntp | grep ':8080'
sudo journalctl -u user -f
```

### MongoDB Connectivity Test

```bash
getent hosts mongodb.ravi-devops.space

nc -vz -w 5 mongodb.ravi-devops.space 27017
```

### Redis Connectivity Test

```bash
getent hosts redis.ravi-devops.space

nc -vz -w 5 redis.ravi-devops.space 6379
```

If `nc` is not installed:

```bash
sudo dnf install nmap-ncat -y
```

### Restart After Configuration Changes

```bash
sudo systemctl daemon-reload
sudo systemctl restart user
sudo systemctl status user --no-pager
```

### Check Application Files

```bash
ls -la /app
cat /app/package.json
```

---

## 10. Important Security Notes

- Never commit real passwords, tokens, or production credentials to GitHub.
- `.env.example` should contain placeholders or non-sensitive defaults only.
- Use MongoDB authentication and TLS where required by your environment.
- Restrict CORS to trusted frontend origins in production.
- Add unique MongoDB indexes for `email` and `username` to prevent duplicate registrations.
- Validate request fields and enforce reasonable password-length limits.
- Use HTTPS at the public-facing load balancer or reverse proxy.
- Do not expose port 8080 publicly when the service is intended for internal VPC communication.

---

## 11. Final Validation Checklist

- [ ] Node.js 20 is installed.
- [ ] Application files exist in `/app`.
- [ ] npm dependencies are installed.
- [ ] MongoDB DNS and connectivity work.
- [ ] Redis DNS and connectivity work.
- [ ] `user.service` is enabled and running.
- [ ] Port 8080 is listening.
- [ ] `/health` returns HTTP 200.
- [ ] Registration and login work.
- [ ] Token verification works.
- [ ] Route 53 resolves to the correct private IP.
- [ ] Security Group rules allow only required service-to-service traffic.

**User Service deployment is complete when the application, MongoDB, Redis, DNS, and required network rules are all working together.**
