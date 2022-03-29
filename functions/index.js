const functions = require("firebase-functions");
const admin = require("firebase-admin");
const { _objectWithOptions } = require("firebase-functions/v1/storage");
admin.initializeApp();

const { generateToken04 } = require("./token04/server/zegoServerAssistant");
const appID = {your_app_id};
const secret = "{your_server_secret}";

// // Create and Deploy Your First Cloud Functions
// // https://firebase.google.com/docs/functions/write-firebase-functions
//
// exports.helloWorld = functions.https.onRequest((request, response) => {
//   functions.logger.info("Hello logs!", {structuredData: true});
//   response.send("Hello from Firebase!");
// });

exports.callUserNotify = functions.database.ref("/call/{call_id}")
    .onCreate(async (snapshot, context) => {
      // Grab the current value of what was written to the Realtime Database.
      const callData = snapshot.val();
      // functions.logger.log("call user11,", context.params.call_id, original);

      functions.logger.log("call user11,", callData.users);
      const result = await admin.auth().getUser(context.auth.uid);
      const callerName = result.displayName;

      const tokensPromise = [];
      for (const key in callData.users ) {
        const value = callData.users[key];
        if ( value.caller_id != value.user_id ) {
          const tokenPos = `/push_token/${value.user_id}`;
          tokensPromise.push(admin.database().ref(tokenPos).once("value"));
        }
      }
      const results = await Promise.all(tokensPromise);

      let tokensValue = []
      results.forEach((result, index) => {
        const tokensSnapshot = result;
        if(tokensSnapshot.hasChildren()){
          const tokens = Object.values(tokensSnapshot.val());
          tokensValue.push(...tokens);
        }
      });
      functions.logger.log("call66,", tokensValue);
      if(tokensValue.length == 0){
        return;
      }

      const callType = callData.call_type;
      const callID = callData.call_id;

      const androidPayload = {
        data:{
          title: 'You have a new call!',
          body: `${callerName} is now calling you.`,
          call_id: `${callID}`,
          call_type: `${callType}`,
          caller_id: `${context.auth.uid}`,
          caller_name:`${callerName}`,
        }
      };
      const iosPayload = {
        notification: {
          title: 'You have a new call!',
          body: `${callerName} is now calling you.`
        },
        data:{
          call_id: `${callID}`,
          call_type: `${callType}`,
          caller_id: `${context.auth.uid}`,
          caller_name:`${callerName}`,
          'click_action': 'NOTIFICATION_CLICK',
        }
      };

      const androidTarget = tokensValue.filter(function(x){ 
        return (x['device_type'] == 'android') 
      }).map(function(x){ 
        return x['token_id']
      });
      const iosTarget = tokensValue.filter(function(x){ 
        return (x['device_type'] == 'ios') 
      }).map(function(x){ 
        return x['token_id']
      });
      functions.logger.log("androidTarget,", androidTarget);
      functions.logger.log("iosTarget,", iosTarget);

      let promise = [];
      let androidPush;
      if(androidTarget.length > 0){
        androidPush = admin.messaging().sendToDevice(androidTarget, androidPayload);
        promise.push(androidPush);
      }
      let iosPush;
      if(iosTarget.length > 0){
        iosPush = admin.messaging().sendToDevice(iosTarget, iosPayload);
        promise.push(iosPush);
      }
      
      // const target = tokensValue.map(function(x){ return x['token_id']})
      // functions.logger.log("call77,", target);
      const response = await Promise.all(promise);

      // For each message check if there was an error.
      // const tokensToRemove = [];
      
      // response.results.forEach((result, index) => {
      //   const error = result.error;
      //   if (error) {
      //     functions.logger.error('Failure sending notification to',
      //     target[index],
      //       error
      //     );
      //     // Cleanup the tokens who are not registered anymore.
      //     if (error.code === 'messaging/invalid-registration-token' ||
      //         error.code === 'messaging/registration-token-not-registered') {
      //       tokensToRemove.push(target[index]);
      //     }
      //   }
      // });

      // return Promise.all(tokensToRemove);
    });

exports.onCallUpdate = functions.database.ref("/call/{call_id}")
    .onUpdate(async (change, context) => {
        // Only edit data when it is first created.
      if (!change.before.exists()) {
        return null;
      }
      // Exit when the data is deleted.
      if (!change.after.exists()) {
        return null;
      }
       // Grab the current value of what was written to the Realtime Database.
      const after = change.after.val();
      const before = change.before.val();

      functions.logger.log("before,", before);
      functions.logger.log("after,", after);

      if(after['call_status'] >= 3){
        return change.after.ref.remove()
      }
    });

exports.getToken = functions.https.onCall((data, context) => {
    if (!(context.auth && context.auth.uid)) {
        throw new functions.https.HttpsError('permission-denied', 'Must be signed in!');
    }
    const userID = data.id;
    const effectiveTimeInSeconds = data.effective_time;
    if (effectiveTimeInSeconds <= 0) {
        throw new functions.https.HttpsError('parameter-invalid', 'Effective time must be greater then zero!');
    }
    const payload = '';

    // Build token 
    const token =  generateToken04(appID, userID, secret, effectiveTimeInSeconds, payload);

    return {
        token: token
    };
});
