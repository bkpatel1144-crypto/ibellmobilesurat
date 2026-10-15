import { Smartphone } from 'lucide-react';

/** Shown when the .env file with the Firebase config is missing. */
export default function Setup() {
  return (
    <div className="auth-page">
      <div className="auth-card glass--large page" style={{ width: 'min(620px, 100%)' }}>
        <div className="auth-logo">
          <Smartphone size={30} />
        </div>
        <h1 style={{ textAlign: 'center', marginBottom: 8 }}>Connect Firebase</h1>
        <p className="muted" style={{ textAlign: 'center' }}>IBELL MOBILE needs a Firebase project before it can start.</p>
        <ol className="stack-sm" style={{ paddingLeft: 20, lineHeight: 1.6 }}>
          <li>Create a project at <b>console.firebase.google.com</b>.</li>
          <li>Enable <b>Authentication → Sign-in method → Email/Password</b>, then add your user under <b>Users</b>.</li>
          <li>Create a <b>Firestore Database</b> (production mode).</li>
          <li>Add a <b>Web app</b> in Project settings and copy its config.</li>
          <li>Copy <code>.env.example</code> to <code>.env</code>, paste the values, and restart <code>npm run dev</code>.</li>
          <li>Put your e-mail in <code>firestore.rules</code> and run <code>firebase deploy --only firestore:rules</code>.</li>
        </ol>
      </div>
    </div>
  );
}
