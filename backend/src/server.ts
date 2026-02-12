import express from 'express';
import cors from 'cors';

const app = express();
const port = 3000;

app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
  res.send('Hello from Agent Web Backend (Node 24 + TS)');
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
