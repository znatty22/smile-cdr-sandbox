
# Smile CDR Access Control

Refer to docs/access_control.md for detailed info on role and policy definition

# Smile CDR User
- This can represent either a human user or a client
- This user authenticates via basic authentication

## User Details Object 
https://smilecdr.com/docs/javascript_execution_environment/callback_models.html#userdetails

- Store the actions the user is authorized to take in the user details 
`authorities` field
- Store the studies that the user has access to in the user details `notes` field

```javascript
user.authorities = [
    {
        permission: 'FHIR_ALL_READ'   
    }
]
user.notes = '{"studies": {"SD-0": {"read": true, "update": false, "delete": false}, "SD-1": {"read": true, "update": false, "delete": false}}}'
```

### Read Only Super User
```
Permission
- `ROLE_SUPERUSER`

Consent
- Always authorized to see any data
```

### Study Viewer 
```
Permission
- `FHIR_ALL_READ`

Consent
- Parse user.notes into list of study objects 
- If resource being accessed has a study_id tag that is in the user's
list of read study IDs, then authorize the request
```

### Ingest Client 
```
Permission
- `FHIR_ALL_READ`
- `FHIR_ALL_WRITE`
- `FHIR_ALL_DELETE`

Consent
- Parse user.notes into list of study objects 
- If resource being accessed has a study_id tag that is in the user's
list of read study IDs, then authorize the request
```
