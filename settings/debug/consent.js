function consentStartOperation(
  theRequestDetails,
  theUserSession,
  theContextServices,
  theClientSession
) {
  Log.info("******** consentStartOperation ******** ");
  theContextServices.authorized();
}

// function consentCanSeeResource(
//   theRequestDetails,
//   theUserSession,
//   theContextServices,
//   theResource,
//   theClientSession
// ) {
//   Log.info("******** consentCanSeeResource ******** ");

//   // Testing
//   theContextServices.reject();
// }
