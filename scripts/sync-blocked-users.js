```javascript
const admin = require("firebase-admin");

const projectId = process.env.FIREBASE_PROJECT_ID;
const serviceAccountText = process.env.FIREBASE_SERVICE_ACCOUNT;

if (!projectId || !serviceAccountText) {
  throw new Error("Missing Firebase project ID or service account secret.");
}

const serviceAccount = JSON.parse(serviceAccountText);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  projectId,
});

const db = admin.firestore();
const auth = admin.auth();

async function getAllUsers() {
  const users = [];
  let pageToken;

  do {
    const result = await auth.listUsers(1000, pageToken);
    users.push(...result.users);
    pageToken = result.pageToken;
  } while (pageToken);

  return users;
}

async function syncBlockedUsers() {
  const blockedSnapshot = await db.collection("blockedEmails").get();

  const blockedEmails = new Set(
    blockedSnapshot.docs.map((doc) => doc.id.trim().toLowerCase())
  );

  const users = await getAllUsers();
  const managedSnapshot = await db
    .collection("authAutomationDisabled")
    .get();

  const managedUids = new Set(managedSnapshot.docs.map((doc) => doc.id));

  let disabledCount = 0;
  let enabledCount = 0;

  for (const user of users) {
    const email = (user.email || "").trim().toLowerCase();
    const marker = db.collection("authAutomationDisabled").doc(user.uid);

    if (blockedEmails.has(email) && !user.disabled) {
      await marker.set({
        email,
        markedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      try {
        await auth.updateUser(user.uid, { disabled: true });
        disabledCount++;
        console.log(`Disabled: ${email}`);
      } catch (error) {
        await marker.delete();
        throw error;
      }
    } else if (!blockedEmails.has(email) && managedUids.has(user.uid)) {
      if (user.disabled) {
        await auth.updateUser(user.uid, { disabled: false });
      }

      await marker.delete();
      enabledCount++;
      console.log(`Unblocked by automation: ${email}`);
    }
  }

  console.log(
    `Sync complete. Disabled: ${disabledCount}; enabled: ${enabledCount}.`
  );
}

syncBlockedUsers().catch((error) => {
  console.error("Firebase user sync failed:", error);
  process.exitCode = 1;
});
```
