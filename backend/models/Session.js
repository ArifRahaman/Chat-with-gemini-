import mongoose from 'mongoose';

const SessionSchema = new mongoose.Schema({
  userId: { type: String, required: true, index: true },
  title: { type: String, default: 'New Chat' },
  createdAt: { type: Date, default: Date.now },
});

export default mongoose.model('Session', SessionSchema);
