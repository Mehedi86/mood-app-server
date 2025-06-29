const express = require('express');
const cors = require('cors');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
require('dotenv').config();
const serverless = require('serverless-http');

const app = express();
app.use(cors());
app.use(express.json());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.kpht8.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

let userCollection, moodCollection, recycleCollection;

async function connectDB() {
    try {
        await client.connect();
        const db = client.db('mood');
        userCollection = db.collection('users');
        moodCollection = db.collection('moods');
        recycleCollection = db.collection('recycle');
        console.log("✅ Connected to MongoDB");
    } catch (err) {
        console.error("❌ MongoDB connection failed:", err);
    }
}
connectDB();

// Routes
app.get('/', (req, res) => {
    res.send('🟢 API Running on Vercel');
});

app.post('/api/register', async (req, res) => {
    const { phone, password } = req.body;
    if (!phone || !password) {
        return res.status(400).json({ success: false, message: 'Phone and password are required' });
    }

    const existingUser = await userCollection.findOne({ phone });
    if (existingUser) {
        return res.status(400).json({ success: false, message: 'Phone already registered' });
    }

    const result = await userCollection.insertOne({ phone, password });
    res.json({ success: true, message: 'User registered successfully', insertedId: result.insertedId });
});

app.post('/api/login', async (req, res) => {
    const { phone, password } = req.body;
    if (!phone || !password) {
        return res.status(400).json({ success: false, message: 'Phone and password are required' });
    }

    const user = await userCollection.findOne({ phone });
    if (!user || user.password !== password) {
        return res.status(401).json({ success: false, message: 'Invalid phone or password' });
    }

    res.json({ success: true, message: 'Login successful', data: phone });
});

app.post('/api/mood-entry', async (req, res) => {
    const { phone, date, mood, note } = req.body;

    if (!phone || !date || !mood) {
        return res.status(400).json({ success: false, message: 'Phone, date, and mood are required' });
    }

    const existing = await moodCollection.findOne({ phone, date });
    if (existing) {
        return res.status(400).json({ success: false, message: 'Mood already submitted for this date' });
    }

    const result = await moodCollection.insertOne({
        phone,
        date,
        mood,
        note,
        deleted: false,
    });

    res.json({ success: true, message: 'Mood saved', id: result.insertedId });
});

app.get('/api/mood-status', async (req, res) => {
    const { phone, date } = req.query;
    if (!phone || !date) {
        return res.status(400).json({ success: false, message: 'Phone and date are required' });
    }

    const exists = await moodCollection.findOne({ phone, date, deleted: false });
    res.json({ success: true, exists: !!exists });
});

app.get('/api/mood-history', async (req, res) => {
    const { phone } = req.query;
    if (!phone) return res.status(400).json({ success: false, message: 'Phone is required' });

    try {
        const entries = await moodCollection.find({ phone, deleted: false }).toArray();
        res.json({ success: true, entries });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch moods' });
    }
});

app.patch('/api/mood-delete/:id', async (req, res) => {
    const id = req.params.id;
    try {
        const existing = await moodCollection.findOne({ _id: new ObjectId(id) });
        if (!existing) return res.status(404).json({ success: false, message: 'Mood not found' });

        await recycleCollection.insertOne({ ...existing, deletedAt: new Date() });
        await moodCollection.updateOne({ _id: new ObjectId(id) }, { $set: { deleted: true } });

        res.json({ success: true, message: 'Mood moved to recycle bin' });
    } catch (err) {
        console.error('Soft delete error:', err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

app.get('/api/recycle-bin', async (req, res) => {
    const { phone } = req.query;
    if (!phone) return res.status(400).json({ success: false, message: 'Phone required' });

    try {
        const deleted = await recycleCollection.find({ phone }).toArray();
        res.json({ success: true, entries: deleted });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch deleted entries' });
    }
});

app.patch('/api/restore-mood/:id', async (req, res) => {
    const id = req.params.id;

    try {
        const doc = await recycleCollection.findOne({ _id: new ObjectId(id) });
        if (!doc)
            return res.status(404).json({ success: false, message: 'Entry not found in recycle bin' });

        const { _id, deletedAt, ...restoredData } = doc;

        await moodCollection.insertOne({ ...restoredData, deleted: false });
        await recycleCollection.deleteOne({ _id: new ObjectId(id) });

        res.json({ success: true, message: 'Mood restored successfully' });
    } catch (err) {
        console.error('Restore failed:', err);
        res.status(500).json({ success: false, message: 'Restore failed' });
    }
});

app.delete('/api/permanent-delete/:id', async (req, res) => {
    const id = req.params.id;

    try {
        const result = await recycleCollection.deleteOne({ _id: new ObjectId(id) });
        if (result.deletedCount === 0) {
            return res.status(404).json({ success: false, message: 'Entry not found' });
        }
        res.json({ success: true, message: 'Mood permanently deleted' });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Permanent delete failed' });
    }
});

// Export the app wrapped in serverless-http for Vercel
module.exports = serverless(app);
