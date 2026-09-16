import mongoose from 'mongoose';

mongoose.set('bufferCommands', false); // CRITICAL: fail fast, don't hang

function isValidMongoUri(uri) {
  if (!uri || typeof uri !== 'string') return false;
  const trimmed = uri.trim();
  if (!trimmed) return false;
  // Check for template placeholder brackets like <username>, <password>, <cluster>, etc.
  if (/<[a-zA-Z0-9_\-\s]+>/.test(trimmed)) {
    return false;
  }
  return trimmed.startsWith('mongodb://') || trimmed.startsWith('mongodb+srv://');
}

let connectingPromise = null;

export async function connectDB(uri) {
  if (mongoose.connection.readyState === 1) {
    return true;
  }

  if (connectingPromise) {
    return connectingPromise;
  }

  if (!isValidMongoUri(uri)) {
    console.log('[AI Studio] Using in-memory data store (MongoDB URI not configured or placeholder detected)');
    return false;
  }

  connectingPromise = (async () => {
    try {
      await mongoose.connect(uri, {
        autoIndex: true,
        serverSelectionTimeoutMS: 10000,
      });
      console.log('[AI Studio] Connected to MongoDB');
      return true;
    } catch (err) {
      console.log('[AI Studio] MongoDB connection unavailable — using in-memory store:', err.message);
      return false;
    } finally {
      connectingPromise = null;
    }
  })();

  return connectingPromise;
}


