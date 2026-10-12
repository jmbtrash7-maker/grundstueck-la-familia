<script type="module">
  // Import the functions you need from the SDKs you need
  import { initializeApp } from "https://www.gstatic.com/firebasejs/13.0.0/firebase-app.js";
  import { getAnalytics } from "https://www.gstatic.com/firebasejs/13.0.0/firebase-analytics.js";
  // TODO: Add SDKs for Firebase products that you want to use
  // https://firebase.google.com/docs/web/setup#available-libraries

  // Your web app's Firebase configuration
  // For Firebase JS SDK v7.20.0 and later, measurementId is optional
  const firebaseConfig = {
    apiKey: "AIzaSyCiO1Whf00n2X9FEopvBXryuTJ2bFs3CAo",
    authDomain: "grundstueck-la-famiglia.firebaseapp.com",
    projectId: "grundstueck-la-famiglia",
    storageBucket: "grundstueck-la-famiglia.firebasestorage.app",
    messagingSenderId: "948673865270",
    appId: "1:948673865270:web:0b749f2a94359deaad5a97",
    measurementId: "G-2WWY0XR8YB"
  };

  // Initialize Firebase
  const app = initializeApp(firebaseConfig);
  const analytics = getAnalytics(app);
</script>