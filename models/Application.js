{
  "name": "sk-vk-job-portal",
  "version": "1.0.0",
  "description": "SK VK Job Portal - Resume Parser & Job Tracker",
  "main": "api/index.js",
  "scripts": {
    "start": "node api/index.js",
    "dev": "nodemon api/index.js"
  },
  "dependencies": {
    "bcryptjs": "^2.4.3",
    "cors": "^2.8.5",
    "dotenv": "^16.3.1",
    "express": "^4.18.2",
    "jsonwebtoken": "^9.0.2",
    "mongoose": "^7.6.3",
    "multer": "^1.4.5-lts.1",
    "pdf-parse": "^1.1.1",
    "mammoth": "^1.6.0"
  },
  "devDependencies": {
    "nodemon": "^3.0.1"
  }
}
