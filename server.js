const express = require('express');
const fs = require('fs');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(__dirname));

const RANKING_FILE = path.join(__dirname, 'ranking.json');

// Get rankings
app.get('/api/ranking', (req, res) => {
  fs.readFile(RANKING_FILE, 'utf8', (err, data) => {
    if (err) {
      if (err.code === 'ENOENT') {
        // File doesn't exist yet, return empty list
        return res.json([]);
      }
      return res.status(500).json({ error: 'Failed to read ranking data' });
    }
    try {
      const rankings = JSON.parse(data);
      res.json(rankings);
    } catch (e) {
      res.json([]);
    }
  });
});

// Post score to rankings
app.post('/api/ranking', (req, res) => {
  const { name, score, comment } = req.body;
  if (!name || typeof score !== 'number') {
    return res.status(400).json({ error: 'Name and numeric score are required.' });
  }

  const newEntry = {
    name: name.substring(0, 10),
    score: score,
    comment: comment ? comment.substring(0, 30) : '',
    created_at: new Date().toISOString()
  };

  fs.readFile(RANKING_FILE, 'utf8', (err, data) => {
    let rankings = [];
    if (!err) {
      try {
        rankings = JSON.parse(data);
      } catch (e) {
        rankings = [];
      }
    }

    // Check if the user already exists in rankings
    // We update their score if the new score is higher
    const existingIndex = rankings.findIndex(r => r.name === newEntry.name);
    if (existingIndex !== -1) {
      if (newEntry.score > rankings[existingIndex].score) {
        rankings[existingIndex] = {
          ...rankings[existingIndex],
          score: newEntry.score,
          comment: newEntry.comment,
          created_at: newEntry.created_at
        };
      }
    } else {
      rankings.push(newEntry);
    }

    // Sort by score descending, limit to top 100
    rankings.sort((a, b) => b.score - a.score);
    rankings = rankings.slice(0, 100);

    fs.writeFile(RANKING_FILE, JSON.stringify(rankings, null, 2), 'utf8', (writeErr) => {
      if (writeErr) {
        return res.status(500).json({ error: 'Failed to save score' });
      }
      res.json({ success: true, rankings: rankings.slice(0, 10) });
    });
  });
});

app.listen(PORT, () => {
  console.log(`Server is running at http://localhost:${PORT}`);
});
