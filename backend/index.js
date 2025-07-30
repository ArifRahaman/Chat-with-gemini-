import 'dotenv/config';
import express from 'express';
import fetch from 'node-fetch'; // Keep node-fetch for Deepgram/D-ID if still used
import mongoose from 'mongoose';
import cors from 'cors';
import { Groq } from 'groq-sdk'; // <--- NEW: Import Groq SDK

import User from './models/User.js';
import Session from './models/Session.js';
import Message from './models/Message.js';

const app = express();
app.use(cors());
app.use(express.json());

const {
  GEMINI_KEY, // Still here, but not used for chat anymore
  DEEPGRAM_KEY,
  DID_API_KEY,
  MONGO_URI,
  GROQ_KEY // Make sure this is correctly loaded from your .env
} = process.env;

// --- TEMPORARY DEBUGGING LOG ---
console.log("Server starting. GROQ_KEY (first 5 chars):", GROQ_KEY ? GROQ_KEY.substring(0, 5) : "Not loaded");
// Remember to remove this console.log after debugging for security reasons!
// -------------------------------

// <--- NEW: Initialize Groq SDK
const groq = new Groq({
  apiKey: GROQ_KEY // Pass your API key here
});

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
  // Add a robust check here before proceeding
  if (!role || typeof text !== 'string' || text.trim().length === 0) {
    console.error('Invalid or missing role or text in request body:', req.body);
    return res.status(400).json({ error: 'Message payload missing or invalid (role or text).' });
  }
  try {
    const msg = await Message.create({
      sessionId: req.params.sid,
      role,
      text
    });
    res.json(msg);
  } catch (error) {
    console.error("Error saving message to DB:", error);
    // You can check for Mongoose validation errors specifically
    if (error.name === 'ValidationError') {
      return res.status(400).json({ error: error.message });
    }
    res.status(500).json({ error: 'Failed to save message due to server error.' });
  }
});

// GET /api/chats (This route seems misplaced or unused, keeping for now)
app.get("/chats", async (req, res) => {
  const { user_id, session_id } = req.query;

  try {
    // Assuming Chat model exists, otherwise this will fail
    // const chat = await Chat.findOne({ user_id, session_id }); // Chat model not provided
    // if (!chat) return res.status(404).json({ error: "Chat not found" });
    // res.json(chat.messages);
    res.status(501).json({ error: "This route is not implemented or Chat model is missing." });
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


// -- after your auth middleware but before /api/sessions --

app.post('/api/users', async (req, res) => {
  const { userId } = req.body;
  if (!userId) return res.status(400).send('Missing userId');
  const exists = await User.findOne({ userId });
  if (exists) return res.status(409).send('User already exists');
  const user = await User.create({ userId });
  res.status(201).json(user);
});

// ----- Groq Proxy (UPDATED to use SDK) -----
const GROQ_MODEL = "llama3-8b-8192"; // Or "llama3-70b-8192"
const SYSTEM_CONTEXT =
  "You are a helpful assistant that only answers questions related to Java. If the question is off-topic, reply politely and decline.";

app.post('/api/groq', async (req, res) => {
  const { prompt } = req.body;
  if (!prompt) {
    return res.status(400).json({ error: 'Prompt is required.' });
  }

  try {
    // Use the Groq SDK to create a chat completion
    const chatCompletion = await groq.chat.completions.create({
      messages: [
        { role: "system", content: SYSTEM_CONTEXT },
        { role: "user", content: prompt }
      ],
      model: GROQ_MODEL,
      temperature: 0.7,
      max_tokens: 150,
      stream: false, // <--- Set to false to get a single response for the current client
      top_p: 1,
      stop: null
    });

    // Extract the content from the non-streaming response
    const text = chatCompletion.choices?.[0]?.message?.content;

    if (!text) {
      console.warn("Groq API returned no text content:", chatCompletion);
      return res.status(500).json({ error: "Groq API did not return a valid text response." });
    }

    res.json({ text }); // Send the text back as a single JSON object

  } catch (err) {
    console.error('[Groq Proxy Error]:', err);
    // Check for specific Groq API errors (e.g., invalid key)
    if (err.error && err.error.type === 'invalid_request_error' && err.error.code === 'invalid_api_key') {
        return res.status(401).json({ error: 'Invalid Groq API Key. Please check your .env file.' });
    }
    res.status(500).json({ error: 'Failed to fetch Groq response' });
  }
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
