export const getServerMainJs = (title) => {
    const safeTitle = title.replace(/'/g, "\\'");
    return `
import express from 'express';
import { createServer, context, redis, reddit } from '@devvit/web/server';

const app = express();
app.use(express.json());

// --- Database Helper ---
const DB_REGISTRY_KEY = 'sys:registry';

async function fetchAllData() {
    try {
        const collections = await redis.zRange(DB_REGISTRY_KEY, 0, -1);
        const dbData = {};

        await Promise.all(collections.map(async (item) => {
            const colName = typeof item === 'string' ? item : item.member;
            const raw = await redis.hGetAll(colName);
            const parsed = {};
            for (const [k, v] of Object.entries(raw)) {
                try { 
                    parsed[k] = JSON.parse(v); 
                } catch(e) { 
                    parsed[k] = v; 
                }
            }
            dbData[colName] = parsed;
        }));

        let user = { 
            id: 'anon', 
            username: 'Guest', 
            avatar_url: 'https://www.redditstatic.com/avatars/avatar_default_02_FF4500.png' 
        };
        
        try {
            const currUser = await reddit.getCurrentUser();
            if (currUser) {
                user = {
                    id: currUser.id,
                    username: currUser.username,
                    avatar_url: currUser.snoovatarImage || user.avatar_url
                };
            }
        } catch(e) { 
            console.warn('User fetch failed', e); 
        }

        return { dbData, user };
    } catch(e) {
        console.error('Hydration Error:', e);
        return { dbData: {}, user: null };
    }
}

// --- Routes ---

app.get('/init', async (req, res) => {
    const data = await fetchAllData();
    res.json(data);
});

app.post('/save', async (req, res) => {
    try {
        const { collection, key, value } = req.body;
        await redis.hSet(collection, { [key]: JSON.stringify(value) });
        await redis.zAdd(DB_REGISTRY_KEY, { member: collection, score: Date.now() });
        res.json({ success: true, collection, key });
    } catch(e) {
        console.error('DB Save Error:', e);
        res.status(500).json({ error: e.message });
    }
});

app.post('/load', async (req, res) => {
    try {
        const { collection, key } = req.body;
        const value = await redis.hGet(collection, key);
        res.json({ collection, key, value: value ? JSON.parse(value) : null });
    } catch(e) {
        console.error('DB Get Error:', e);
        res.status(500).json({ error: e.message });
    }
});

app.post('/delete', async (req, res) => {
    try {
        const { collection, key } = req.body;
        await redis.hDel(collection, [key]);
        res.json({ success: true, collection, key });
    } catch(e) {
        console.error('DB Delete Error:', e);
        res.status(500).json({ error: e.message });
    }
});

// Internal Handlers

app.post('/internal/onInstall', async (req, res) => {
    console.log('App installed!');
    res.json({ success: true });
});

app.post('/internal/createPost', async (req, res) => {
    console.log('Creating game post...');
    try {
        const { subredditName } = context;
        console.log('Context Subreddit:', subredditName);

        if (!subredditName) {
            throw new Error('Could not determine subreddit from context');
        }

        const post = await reddit.submitCustomPost({
            title: '${safeTitle}',
            subredditName: subredditName,
            entry: 'default', // matches devvit.json entrypoint
            userGeneratedContent: {
                text: 'Play this game built with WebSim!'
            }
        });

        res.json({
            showToast: { text: 'Game post created!' },
            navigateTo: post
        });
    } catch (e) {
        console.error('Failed to create post:', e);
        res.status(500).json({ error: e.message });
    }
});

const server = createServer(app);
export default server;
`;
};

