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
const MONGO_URL = process.env.MONGO_URL || 'mongodb://mongodb.ravi-devops.space:27017';
const REDIS_HOST = process.env.REDIS_HOST || 'redis.ravi-devops.space';
const REDIS_PORT = process.env.REDIS_PORT || 6379;
const DB_NAME = process.env.DB_NAME || 'eventsphere';

let db = null;
let redisClient = null;

async function initClients() {
  try {
    const mongoClient = new MongoClient(MONGO_URL, { connectTimeoutMS: 5000 });
    await mongoClient.connect();
    db = mongoClient.db(DB_NAME);
    console.log(`[user-service] Connected to MongoDB at ${MONGO_URL}`);

    redisClient = createClient({
      url: `redis://${REDIS_HOST}:${REDIS_PORT}`
    });
    redisClient.on('error', (err) => console.error('[user-service] Redis Client Error:', err));
    await redisClient.connect();
    console.log(`[user-service] Connected to Redis at ${REDIS_HOST}:${REDIS_PORT}`);
  } catch (err) {
    console.error(`[user-service] Startup failure: ${err.message}`);
    process.exit(1);
  }
}

// Liveness & Dependency Probe
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
    res.status(503).json({ status: 'DOWN', error: err.message });
  }
});

// Fan Registration
app.post('/api/users/register', async (req, res) => {
  const { username, email, password, fullName } = req.body;
  if (!username || !email || !password) {
    return res.status(400).json({ error: 'Username, email, and password are required' });
  }

  try {
    const existing = await db.collection('users').findOne({
      $or: [{ email }, { username }]
    });

    if (existing) {
      return res.status(409).json({ error: 'User with this email or username already exists' });
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);
    const userId = `USR-${Date.now().toString(36).toUpperCase()}`;

    await db.collection('users').insertOne({
      userId,
      username,
      email,
      fullName: fullName || username,
      passwordHash,
      createdAt: new Date()
    });

    res.status(201).json({ message: 'User registered successfully', userId, username });
  } catch (err) {
    res.status(500).json({ error: 'Registration failed', details: err.message });
  }
});

// User Login & Token Cache in Redis
app.post('/api/users/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  try {
    const user = await db.collection('users').findOne({ email });
    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Generate random session token
    const token = crypto.randomBytes(32).toString('hex');
    const sessionData = {
      userId: user.userId,
      username: user.username,
      email: user.email,
      fullName: user.fullName
    };

    // Store session in Redis with 24 hours TTL (86400 seconds)
    await redisClient.setEx(`session:${token}`, 86400, JSON.stringify(sessionData));

    res.status(200).json({
      message: 'Login successful',
      token,
      user: sessionData
    });
  } catch (err) {
    res.status(500).json({ error: 'Login failed', details: err.message });
  }
});

// Token Verification Endpoint (used by reservation and booking services)
app.get('/api/users/verify', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ valid: false, error: 'Missing or malformed Authorization header' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const cachedSession = await redisClient.get(`session:${token}`);
    if (!cachedSession) {
      return res.status(401).json({ valid: false, error: 'Session expired or invalid' });
    }

    res.status(200).json({ valid: true, user: JSON.parse(cachedSession) });
  } catch (err) {
    res.status(500).json({ valid: false, error: 'Token verification failed' });
  }
});

initClients().then(() => {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[user-service] Listening on port ${PORT}`);
  });
});
