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

exports.onCallCreate = functions.database.ref("/call/{call_id}")
    .onCreate(async (snapshot, context) => {
      // Grab the current value of what was written to the Realtime Database.
      const callData = snapshot.val();
      if(callData.call_id == null){
        functions.logger.log("onCreate ,call_id == null");
        return snapshot.ref.remove()
      }
      // functions.logger.log("call user11,", context.params.call_id, original);

      functions.logger.log("onCreate user11,", callData.users);
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
      functions.logger.log("onCreate 66,", tokensValue);
      if(tokensValue.length == 0){
        return;
      }

      const callType = callData.call_type;
      const callID = callData.call_id;

      const androidPayload = {
        data:{
          call_id: `${callID}`,
          call_type: `${callType}`,
          caller_id: `${context.auth.uid}`,
          caller_name:`${callerName}`,
          call_data: `${JSON.stringify(snapshot.toJSON())}`,
        }
      };
      const iosPayload = {
        notification: {
          title: 'You have a new call!',
          body: `${callerName} is calling you.`
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

      let promise = [];
      let androidPush;
      if(androidTarget.length > 0){
        functions.logger.log("onCreate androidTarget,", androidTarget);
        androidPush = admin.messaging().sendToDevice(androidTarget, androidPayload);
        promise.push(androidPush);
      }
      let iosPush;
      if(iosTarget.length > 0){
        functions.logger.log("onCreate iosTarget,", iosTarget);
        iosPush = admin.messaging().sendToDevice(iosTarget, iosPayload);
        promise.push(iosPush);
      }
      
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
      
      setTimeout(function(){
        snapshot.ref.once("value").then(function(snapshot2) {
          var currentData = snapshot2.val();
          if(currentData == null){
            return;
          }
          if(currentData.call_status == 1){
            currentData.call_status = 3;
            for (const key in currentData.users ) {
              currentData.users[key].status = 7;
            }
            snapshot.ref.update(currentData);
          }
        });
        
      },60000)
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

      if(after['call_status'] >= 3 ){
        return change.after.ref.remove()
      }
      // if(before['call_status'] == 1 && after['call_status'] == 2){
        // setTimeout(function(){
          
          
        // },30000)
        // var Timer = setInterval(function () {
        //   change.after.ref.once("value", function (snapshot) {
        //   })
        // },30000);
      // }
    });

exports.getToken = functions.https.onCall((data, context) => {
    if (!(context.auth && context.auth.uid)) {
        throw new functions.https.HttpsError('permission-denied', 'Must be signed in!');
    }
    const userID = data.id;
    const effectiveTimeInSeconds = data.effective_time;
    functions.logger.log("[Get Token] userID: ", userID, ", effectiveTimeInSeconds: ", effectiveTimeInSeconds);    
    if (effectiveTimeInSeconds <= 0) {
        throw new functions.https.HttpsError('parameter-invalid', 'Effective time must be greater then zero!');
    }
    const payload = '';

    // Build token 
    const token =  generateToken04(appID, userID, secret, effectiveTimeInSeconds, payload);
    functions.logger.log("[Get Token] token: ", token);
        return {
        token: token
    };
});

exports.scheduledFunction = functions.pubsub.schedule('every 10 minutes').onRun(async(context) => {
    const callRef = admin.database().ref("/call");
    const result = await admin.database().ref("/call").once("value");
    const current = new Date().getTime();
    if(result == null || result.val() == null){
      return ;
    }
    const values = Object.values(result.val())
    var removedKeys = []
    for(const calldata of values){
      if(calldata.call_status == 2){
        var toBeCleared = false ;
        const users = Object.values(calldata.users);
        for(const user of users){
          const timeElapsed = current-user.heartbeat_time;
          if(timeElapsed > 180000){
            toBeCleared = true;
            break;
          }
        }
        if(toBeCleared){
          removedKeys.push(calldata.call_id)
        }
      }
    }
    var removedCalls = [];
    removedKeys.forEach(function(key){
      removedCalls.push(admin.database().ref("/call").child(key).remove())
    })
    functions.logger.log("scheduledFunction,removed:" ,removedKeys);
    if(removedCalls.length > 0){
      return await Promise.all(removedCalls);
    }
    
});
