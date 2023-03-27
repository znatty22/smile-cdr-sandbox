// Log = {
//   info: (msg) => console.info(msg),
//   warn: (msg) => console.warn(msg),
//   error: (msg) => console.error(msg),
// };

function extractStudyPermissions(studyPermissions) {
  /*
   * Convert to list of study permission objects and return the list
   * */
  return Object.entries(studyPermissions.studies).map(([study_id, perms]) => {
    return {
      id: study_id,
      ...perms,
    };
  });
}
function allowedStudiesForAction(studyPermissions, action) {
  /*
   * Given an action (read, write, delete), return the study IDs that
   * the user is able to perform the action on
   *
   * If the has blanket permissions for that action (read all studies) then
   * indicate this in the result object
   *
   * Examples:
   *
   * ** Read specific studies **
   * studyPermissions = {
   *  studies: {
   *    SD_0: true
   *  }
   * }
   * result = allowedStudiesForAction(studyPermissions, "read")
   * result = {
   *  all: {
   *    read: false,
   *    write: false,
   *    delete: false
   *  },
   *  studies: ["SD_0"]
   * }
   *
   * ** Read all studies **
   * studyPermissions = {
   *  all: {
   *    read: true
   *  }
   * }
   * result = allowedStudiesForAction(studyPermissions, "read")
   * result = {
   *  all: {
   *    read: true
   *  },
   *  studies: null
   * }
   *
   * */

  result = {
    all: {
      read: false,
      write: false,
      delete: false,
    },
    studies: null,
  };

  malformed = `Unrecognized study permissions ${JSON.stringify(
    studyPermissions
  )}`;
  // Check if user has read all, write all, or delete all permissions
  if (studyPermissions.all) {
    if (studyPermissions.all[action]) {
      result.all[action] = true;
      // Study permissions are not recognized
    } else {
      Log.warn(malformed);
    }
    return result;

    // If the user has permissions for specific studies, specify which studies
  } else if (
    studyPermissions.studies &&
    Object.keys(studyPermissions.studies).length > 0
  ) {
    studyPermissionList = extractStudyPermissions(studyPermissions);
    result.studies = studyPermissionList
      .filter((studyPermission) => studyPermission[action])
      .map((studyPermission) => studyPermission.id);
  } else {
    Log.warn(malformed);
  }

  return result;
}

/**
 * If present, this function is called before every request. It serves two
 * primary purposes:
 *
 * 1. It can be used to proactively determine that a request does not need
 *    to have the consent service applied to it. This is good for
 *    performance, since applying the consent service has performance
 *    implications.
 * 2. It can be used to proactively load consent directives, user
 *    information, etc. that will be used in future methods.
 *
 * @param theRequestDetails  Contains details about the request (e.g. the
 *                           FHIR operation being performed, the HTTP method,
 *                           the URL, etc.
 * @param theUserSession     Contains details about the logged in user and
 *                           their session.
 * @param theContextServices Contains various utility methods for accessing
 *                           relevant information about the request, as well
 *                           as providing a response.
 * @param theClientSession   Contains details about the OIDC client and
 *                           their OAuth2 session.
 */
function consentStartOperation(
  theRequestDetails,
  theUserSession,
  theContextServices,
  theClientSession
) {
  Log.info("******** consentStartOperation ******** ");
  // For superusers, we will skip the rest of the consent service entirely
  if (theUserSession != null && theUserSession.hasAuthority("ROLE_SUPERUSER")) {
    theContextServices.authorized();
    return true;
  }

  // If user has appropriate role, proceed to next step in consent pipeline
  roles = ["FHIR_ALL_READ", "FHIR_ALL_WRITE"];
  if (
    theUserSession != null &&
    roles.some((role) => theUserSession.hasAuthority(role))
  ) {
    theContextServices.proceed();
    return true;
  }
  Log.info(
    "User has not been assigned any of the acceptable roles necessary for consent authorization"
  );
  theContextServices.reject();

  return false;
}

/**
 * If present, this function is called before every resource that may be returned
 * to the user.
 *
 * @param theRequestDetails  Contains details about the request (e.g. the
 *                           FHIR operation being performed, the HTTP method,
 *                           the URL, etc.
 * @param theUserSession     Contains details about the logged in user and
 *                           their session.
 * @param theContextServices Contains various utility methods for accessing
 *                           relevant information about the request, as well
 *                           as providing a response.
 * @package theResource      The resource that will be accessed.
 * @param theClientSession   Contains details about the OIDC client and
 *                           their OAuth2 session.
 */
function consentCanSeeResource(
  theRequestDetails,
  theUserSession,
  theContextServices,
  theResource,
  theClientSession
) {
  Log.info("******** consentCanSeeResource ******** ");
  // Get request's HTTP operation
  switch (String(theRequestDetails.requestType)) {
    case "GET":
      action = "read";
      break;
    case "POST":
      action = "write";
      break;
    case "PUT":
      action = "write";
      break;
    case "PUT":
      action = "write";
      break;
    case "DELETE":
      action = "delete";
      break;
    default:
      Log.info(
        `REJECT - Unrecognized HTTP operation ${String(
          theRequestDetails.requestType
        )}`
      );
      theContextServices.reject();
      return;
  }

  // Extract study permissions from user session
  try {
    studyPermissions = JSON.parse(theUserSession.notes);
  } catch (e) {
    Log.error(
      "Consent authorizations in UserSession.notes has malformed JSON string. Could not parse"
    );
    theContextServices.reject();
    return;
  }
  result = allowedStudiesForAction(studyPermissions, action);

  // For super users that can do read/write/delete all,
  // skip the rest of the consent service
  if (result.all[action]) {
    theContextServices.authorized();
    Log.info(`Authorized to ${action} ALL studies`);
    return;
  }
  // For read-only users that have been granted access to specific studies,
  // Grant access if the user has access to ALL of the studies tagged on the resource
  isStudyResource = true;
  if (!!result.studies?.length) {
    // *NOTE: Unfortunately Smile CDR requires that the elements in the tags
    // array is only accessed by index so filter and every do not work here
    for (var i in theResource.meta.tag) {
      let tag = theResource.meta.tag[i];
      if (tag.system !== "urn:study_id") {
        continue;
      }
      isStudyResource = isStudyResource && result.studies.includes(tag.code);
    }
    if (isStudyResource) {
      theContextServices.authorized();
      Log.info(
        `Authorized to ${action} specific studies\n${JSON.stringify(result)}`
      );
      return;
    }
  }
  Log.info("Not authorized to access any studies yet");
  theContextServices.reject();
}

// ******************************** TEST ********************************
// request = {
//   requestType: "GET",
// };
// resource = {
//   meta: {
//     tags: [
//       {
//         system: "urn:study_id",
//         code: "SD-1",
//       },
//     ],
//   },
// };
// context = {
//   authorized: function () {
//     // console.log("Authorized!!!");
//   },
//   reject: function () {
//     // console.log("403 Forbidden!!!");
//   },
//   proceed: function () {
//     // console.log("Proceeding to consent can see resource");
//   },
// };
// user = {
//   role: "FHIR_ALL_READ",
//   notes:
//     '{"studies": {"SD-0": {"read": false, "write": false, "delete": false}, "SD-1": {"read": true, "write": false, "delete": false}}}',
//   // '{"all": { "foo": true }}',
//   // "",
//   hasAuthority: function (role) {
//     return this.role == role;
//   },
// };

// proceed = consentStartOperation(request, user, context);
// if (proceed) {
//   consentCanSeeResource(request, user, context, resource);
// }
