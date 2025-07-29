// server.js
import 'dotenv/config';
import express from 'express';
import fetch from 'node-fetch';
import mongoose from 'mongoose';
import cors from 'cors';

import User from './models/User.js';
import Session from './models/Session.js';
import Message from './models/Message.js';

const app = express();
app.use(cors());
app.use(express.json());

const {
  GEMINI_KEY,
  DEEPGRAM_KEY,
  DID_API_KEY,
  MONGO_URI
} = process.env;

// ----- Connect to MongoDB -----
await mongoose.connect(MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

// ----- Auth Middleware -----
app.use(async (req, res, next) => {
  const userId = req.headers['x-user-id'];
  if (!userId) return res.status(401).send('Missing X-User-Id');
  let user = await User.findOne({ userId });
  if (!user) user = await User.create({ userId });
  req.user = user;
  next();
});

// ----- Session & Message Routes -----

// Create a new chat session
app.post('/api/sessions', async (req, res) => {
  const session = await Session.create({
    userId: req.user.userId,
    title: req.body.title || 'New Chat'
  });
  res.json(session);
});

// List all sessions for this user
app.get('/api/sessions', async (req, res) => {
  const sessions = await Session
    .find({ userId: req.user.userId })
    .sort('-createdAt');
  res.json(sessions);
});

// Get messages for a session
app.get('/api/sessions/:sid/messages', async (req, res) => {
  const msgs = await Message
    .find({ sessionId: req.params.sid })
    .sort('timestamp');
  res.json(msgs);
});

// Post a message (user or bot)
app.post('/api/sessions/:sid/messages', async (req, res) => {
  const { role, text } = req.body;
  const msg = await Message.create({
    sessionId: req.params.sid,
    role,
    text
  });
  res.json(msg);
});

// GET /api/chats
app.get("/chats", async (req, res) => {
  const { user_id, session_id } = req.query;

  try {
    const chat = await Chat.findOne({ user_id, session_id });
    if (!chat) return res.status(404).json({ error: "Chat not found" });

    res.json(chat.messages);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// Rename a session’s title
app.patch('/api/sessions/:sid', async (req, res) => {
  const { title } = req.body;
  const sess = await Session.findOneAndUpdate(
    { _id: req.params.sid, userId: req.user.userId },
    { title },
    { new: true }
  );
  if (!sess) return res.status(404).send('Session not found');
  res.json(sess);
});

// Delete a session and all its messages
app.delete('/api/sessions/:sid', async (req, res) => {
  const sid = req.params.sid;
  // remove messages
  await Message.deleteMany({ sessionId: sid });
  // remove session
  const result = await Session.findOneAndDelete({ _id: sid, userId: req.user.userId });
  if (!result) return res.status(404).send('Session not found');
  res.sendStatus(204);
});


// ----- Gemini Proxy -----
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_KEY}`;
const SYSTEM_CONTEXT =
  "You are a helpful assistant that only answers questions related to computer networks. If the question is off-topic, reply politely and decline.";

app.post('/api/gemini', async (req, res) => {
  const { prompt } = req.body;
  try {
    const payload = {
      contents: [{
        role: 'user',
        parts: [{ text: SYSTEM_CONTEXT + "\n\nUser: " + prompt }],
      }],
    };
    const response = await fetch(GEMINI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    res.json({ text });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch Gemini response' });
  }
});
// -- after your auth middleware but before /api/sessions --

app.post('/api/users', async (req, res) => {
  const { userId } = req.body;
  if (!userId) return res.status(400).send('Missing userId');
  const exists = await User.findOne({ userId });
  if (exists) return res.status(409).send('User already exists');
  const user = await User.create({ userId });
  res.status(201).json(user);
});


// ----- Deepgram TTS Proxy -----
app.post('/api/speak', async (req, res) => {
  const { text } = req.body;
  try {
    const dgRes = await fetch(
      'https://api.deepgram.com/v1/speak?model=aura-asteria-en',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Token ${DEEPGRAM_KEY}`,
        },
        body: JSON.stringify({ text }),
      }
    );
    if (!dgRes.ok) {
      const errText = await dgRes.text();
      console.error('Deepgram Error:', errText);
      return res.status(500).json({ error: 'TTS failed' });
    }
    res.setHeader('Content-Type', 'audio/mpeg');
    dgRes.body.pipe(res);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'TTS generation failed' });
  }
});

// ----- D‑ID Talking Avatar Proxy -----
app.post('/api/did', async (req, res) => {
  const { text } = req.body;
  const payload = {
    script: {
      type: 'text',
      input: text,
      provider: { type: 'tts', voice_id: 'en-US-Wavenet-F' }
    },
    source_url: 'https://create-images-results.d-id.com/default-avatar.jpg',
    config: {
      align_expand_factor: 0,
      normalization_factor: 0,
      pad_audio: true
    }
  };

  try {
    const createRes = await fetch('https://api.d-id.com/talks', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${DID_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });
    const { id } = await createRes.json();

    if (!id) {
      return res.status(500).json({ error: 'Failed to start D‑ID generation' });
    }

    // Poll until video ready
    const pollUrl = `https://api.d-id.com/talks/${id}`;
    let videoUrl = null;
    while (!videoUrl) {
      await new Promise(r => setTimeout(r, 2000));
      const pollRes = await fetch(pollUrl, {
        headers: { Authorization: `Bearer ${DID_API_KEY}` }
      });
      const pollData = await pollRes.json();
      videoUrl = pollData.result_url;
    }
    res.json({ videoUrl });

  } catch (err) {
    console.error('[D-ID Error]', err);
    res.status(500).json({ error: 'D-ID API failed' });
  }
});

// ----- Start Server -----
app.listen(5000, () => {
  console.log('🚀 Server running on http://localhost:5000');
});
