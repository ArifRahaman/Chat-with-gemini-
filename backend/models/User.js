import mongoose from 'mongoose';

const UserSchema = new mongoose.Schema({
  userId: { type: String, unique: true, required: true },
  // you can add e.g. name, email here later
});

export default mongoose.model('User', UserSchema);
