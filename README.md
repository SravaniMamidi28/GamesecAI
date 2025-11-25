# 🎮 GameSecAI
### An Adaptive, AI-Powered Cybersecurity Awareness Platform  

⚠️ **Note:**  
This platform is part of an academic capstone project.  
It is **not IRB-approved for public research participation**, and the live deployment is intended **solely for faculty review and demonstration.**

---

## 📌 Overview
GameSecAI is a browser-based cybersecurity training platform that combines **AI-powered adaptive learning**, **behavioral analytics**, and **gamified threat simulations**.  
It evaluates not just *what* users answer — but *how* they think, react, and behave during cybersecurity decision-making.

GameSecAI integrates:
- Google Gemini AI  
- Firebase Hosting & Firestore  
- JavaScript (ES6)  
- Chart.js  
- Real-time behavior tracking  

---

## ⭐ Features

### 🔹 AI-Based Adaptive Questioning
- Dynamically generated or modified questions via Google Gemini  
- Difficulty adjusts based on user behavior and accuracy  
- Personalized explanations after each question  

### 🔹 Behavioral Analysis
Tracks:
- Response time (hesitation)
- Hover time
- Answer switching
- Confidence levels
- Accuracy

### 🔹 Gamified Missions
- Phishing  
- Password Strength  
- Unsafe Websites  
- Wi-Fi Threat Detection  

### 🔹 Risk Scoring System
M = (Phishing + Password + WiFi) / 3
R = 100 - M

yaml
Copy code
Personas include:
- Cyber Defender  
- Cautious Analyzer  
- Overthinker  
- Risky Clicker  

### 🔹 Admin Dashboard
- Leaderboard  
- Performance logs  
- CSV export  
- Role-based access  

---

## 🏗️ Project Structure

GameSecAI/
│── Demo/
│ ├── public/
│ │ ├── index.html
│ │ ├── css/
│ │ ├── js/
│ │ └── data/
│ ├── functions/
│ │ ├── index.js
│ │ ├── package.json
│ ├── firebase.json
│ └── .firebaserc
│── .gitignore

yaml
Copy code

---

## 🛠️ Tech Stack

**Frontend:**  
- HTML, CSS, JavaScript  
- Chart.js  

**Backend:**  
- Firebase Hosting  
- Firebase Firestore  
- Firebase Cloud Functions  

**AI Engine:**  
- Google Gemini 2.5 Flash  

---

## 🚀 How to Run Locally (Developer Setup Only)

git clone https://github.com/SravaniMamidi28/GameSecAI.git
cd GameSecAI/Demo
npm install -g firebase-tools
firebase login
firebase serve
(Deployment to Firebase is limited to internal academic reviewers.)

👩‍💻 Authors


Kale Sanjana Eswara Rao
kalesanjana06@gmail.com

Mamidi Sravani Sravya
mamidisravanisravya@gmail.com

Sudini Shashanth Reddy
shashanthreddy18@gmail.com

📄 Project License
No open-source license is applied.
All rights reserved.
This project is for academic evaluation only.
