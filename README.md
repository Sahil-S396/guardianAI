# GuardianAI

GuardianAI is an intelligent, AI-powered hospital safety and management system built with React, Vite, Firebase, and Google Gemini API. It provides a comprehensive suite of tools for real-time monitoring, emergency response, and staff management to ensure a safe environment for patients and healthcare workers.

## Features

- **AI-Powered Emergency Insights:** Leverages Google Gemini API to analyze emergency contexts (e.g., fires, falls) and generate structured, actionable response plans, including severity assessment, immediate actions, and estimated response times.
- **Smart Camera Monitoring:** Analyzes live hospital safety camera frames to detect hazards like visible fire, smoke, or collapsed persons.
- **Hospital Floor Plan Analysis:** Uses advanced computer vision capabilities to trace rooms, corridors, and safety markers from uploaded floor plan images and maps them to a digital coordinate system.
- **Interactive Hospital Map Editor:** A comprehensive tool to design, edit, and visualize hospital floor plans, including zones (ICU, wards, surgery, etc.), cameras, and walls.
- **Real-Time Dashboard & Alerts:** Centralized dashboard for tracking active alerts, room statuses, and ongoing incidents.
- **Staff Tracking:** Manage and track healthcare personnel availability and roles during emergencies.
- **Safety Drills:** Simulate emergency scenarios to train staff and test response times.
- **QR Code Check-In:** Built-in QR generator and check-in system for patient or staff tracking.

## Tech Stack

- **Frontend:** React 19, React Router DOM, Tailwind CSS, Vite
- **Backend/Services:** Firebase (Authentication, Firestore Database)
- **AI Integration:** Google Gemini API (gemini-1.5-flash and gemini-1.5-pro for vision)
- **Linting & Formatting:** ESLint, PostCSS

## Getting Started

### Prerequisites

- Node.js installed
- A Firebase project with Authentication and Firestore enabled
- A Google Gemini API Key

### Installation

1. Clone the repository and navigate to the project directory:
   ```bash
   git clone https://github.com/Sahil-k-Sahoo/guardianAI.git
   cd guardianAI
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Set up environment variables:
   Create a `.env` file in the root directory and add your Firebase configuration and Gemini API key:
   ```env
   VITE_GEMINI_API_KEY=your_gemini_api_key_here
   VITE_FIREBASE_API_KEY=your_firebase_api_key
   VITE_FIREBASE_AUTH_DOMAIN=your_firebase_auth_domain
   VITE_FIREBASE_PROJECT_ID=your_firebase_project_id
   VITE_FIREBASE_STORAGE_BUCKET=your_firebase_storage_bucket
   VITE_FIREBASE_MESSAGING_SENDER_ID=your_messaging_sender_id
   VITE_FIREBASE_APP_ID=your_firebase_app_id
   ```

### Running the Development Server

Start the Vite development server:
```bash
npm run dev
```
The application will be available at `http://localhost:5173`.

### Building for Production

To create a production build:
```bash
npm run build
```

To preview the production build locally:
```bash
npm run preview
```

## Project Structure

- `src/components/`: Reusable React components (UI layouts, cards).
- `src/contexts/`: React context providers (AuthContext, HospitalContext).
- `src/pages/`: Main application views (Dashboard, AIMonitor, HospitalMapEditor, etc.).
- `src/gemini.js`: Integration with Google Gemini API for camera analysis, floor plan parsing, and emergency insights.
- `src/firebase.js`: Firebase configuration and initialization.

## License

This project is licensed under the MIT License.
