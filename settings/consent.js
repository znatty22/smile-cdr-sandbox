Log = {
  info: (msg) => console.info(msg),
  warn: (msg) => console.warn(msg),
  error: (msg) => console.error(msg),
};

function permissionFromHttpOp(httpOp) {
  /*
   * Translate an HTTP operation like GET, PUT, etc to one of the following
   * permissions: read, write, delete
   *
   * If we don't recognize the HTTP operation, then return null
   * */
  switch (httpOp) {
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
      action = null;
  }
  return action;
}
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
   * Or if the user has blanket permissions for that action (read all studies)
   * then indicate this in the auth object
   *
   * Examples:
   *
   * ** Read specific studies **
   * studyPermissions = {
   *  studies: {
   *    SD_0: { read: true }
   *  }
   * }
   * auth = allowedStudiesForAction(studyPermissions, "read")
   * auth = {
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
   *    read: true,
   *    write: false,
   *    delete: false
   *  }
   * }
   * auth = allowedStudiesForAction(studyPermissions, "read")
   * auth = {
   *  all: {
   *    read: true
   *  },
   *  studies: null
   * }
   *
   * */

  auth = {
    all: {},
    studies: null,
  };

  // If the user has permissions for specific studies, specify which studies
  if (
    studyPermissions.studies &&
    Object.keys(studyPermissions.studies).length > 0
  ) {
    studyPermissionList = extractStudyPermissions(studyPermissions);
    auth.studies = studyPermissionList
      .filter((studyPermission) => studyPermission[action])
      .map((studyPermission) => studyPermission.id);
  }
  // Check if user has read all, write all, or delete all permissions
  if (studyPermissions.all && studyPermissions.all[action]) {
    auth.all[action] = true;
  }

  return auth;
}

function isAuthorizedStudyResource(auth, theResource) {
  /*
   * Check if the user is authorized to access theResource or create
   * theResource (in the case that it does not exist yet)
   *
   * To create or access the FHIR resource, all of the study_ids in
   * the resource's tag list must be included in the user's authorized
   * study list
   *
   * The only exception to this is if a new FHIR resource is being created
   * and it has no tags. Users are allowed to create and view any FHIR resources
   * that have 0 study tags
   * */

  // *NOTE: Unfortunately Smile CDR requires that the elements in the tags
  // array is only accessed by index so .filter and .every functions
  // do not work here
  count = 0;
  for (var i in theResource.meta?.tag) {
    let tag = theResource.meta?.tag[i];
    if (tag.system !== "urn:study_id") {
      continue;
    }
    if (auth.studies.includes(tag.code)) {
      count++;
    }
  }
  return count === theResource.meta.tag.length;
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

  // Translate HTTP operation to permission
  action = permissionFromHttpOp(String(theRequestDetails.requestType));
  if (!action) {
    Log.info(`REJECT - Unrecognized HTTP operation ${String(httpOp)}`);
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
  auth = allowedStudiesForAction(studyPermissions, action);

  Log.info(`Calculated auth object: ${JSON.stringify(auth)}`);

  // No access due to no permissions
  if (!(auth.studies?.length > 0 || auth.all[action])) {
    Log.info("Not authorized to access any studies yet");
    theContextServices.reject();
    return;
  }

  // Study specific access
  if (isAuthorizedStudyResource(auth, theResource)) {
    theContextServices.authorized();
    Log.info(
      `Authorized to ${action} specific studies\n${JSON.stringify(auth)}`
    );
    return;
  }
  // Super user blanket access - read/write/delete all,
  if (auth.all[action]) {
    theContextServices.authorized();
    Log.info(`Authorized to ${action} ALL studies`);
    return;
  }

  Log.info("Insufficient authorization to access FHIR resources");
  theContextServices.reject();
  return;
}

// ******************************** TEST ********************************
request = {
  requestType: "POST",
};
resource = {
  meta: {
    tag: [
      {
        system: "urn:study_id",
        code: "SD-0",
      },
    ],
  },
};
context = {
  authorized: function () {
    // console.log("Authorized!!!");
  },
  reject: function () {
    // console.log("403 Forbidden!!!");
  },
  proceed: function () {
    // console.log("Proceeding to consent can see resource");
  },
};
user = {
  roles: ["FHIR_ALL_READ", "FHIR_ALL_WRITE"],
  notes:
    '{"studies": {"SD-0": {"read": true, "write": true, "delete": false}, "SD-1": {"read": false, "write": false, "delete": false}}, "all": { "read": true }}',
  // '{"studies": {"SD-0": {"read": false, "write": true, "delete": false}}, "all": {"read": true, "write": false, "delete": false}}',
  // '{"all": { "foo": true }}',
  // "",
  hasAuthority: function (role) {
    return this.roles.includes(role);
  },
};

proceed = consentStartOperation(request, user, context);
if (proceed) {
  consentCanSeeResource(request, user, context, resource);
}
