require('dotenv').config();
const app = require('./api/index');

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`SKVK server running at http://localhost:${PORT}`);
});
