import mongoose from 'mongoose';

const MessageSchema = new mongoose.Schema({
  sessionId: { type: mongoose.Types.ObjectId, required: true, index: true },
  role: { type: String, enum: ['user','bot'], required: true },
  text: { type: String, required: true },
  timestamp: { type: Date, default: Date.now },
});

export default mongoose.model('Message', MessageSchema);
