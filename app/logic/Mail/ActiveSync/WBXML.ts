const kWBXMLVersion = 0x03; // WBXML 1.3
const kDTD = 0x01; // unspecified
const kUTF8 = 0x6A;
const kSwitchPage = 0x00;
const kEndTag = 0x01;
const kInlineString = 0x03;
const kInlineCDATA = 0x0C3;
const kHasContent = 0x40;
const kTags = [
  [,,,,, "Sync", "Responses", "Add", "Change", "Delete",, "SyncKey", "ClientId", "ServerId", "Status", "Collection", "Class",, "CollectionId", "GetChanges", "MoreAvailable", "WindowSize", "Commands", "Options",,,,, "Collections", "ApplicationData", "DeletesAsMoves",, "Supported",, "MIMESupport"],
  [,,,,,,,, "Birthday",,,, "Business2PhoneNumber", "BusinessAddressCity", "BusinessAddressCountry", "BusinessAddressPostalCode", "BusinessAddressState", "BusinessAddressStreet", "BusinessFaxNumber", "BusinessPhoneNumber",,,,,, "CompanyName", "Department", "Email1Address", "Email2Address", "Email3Address", "FileAs", "FirstName", "Home2PhoneNumber", "HomeAddressCity", "HomeAddressCountry", "HomeAddressPostalCode", "HomeAddressState", "HomeAddressStreet", "HomeFaxNumber", "HomePhoneNumber", "JobTitle", "LastName",, "MobilePhoneNumber",, "OtherAddressCity", "OtherAddressCountry", "OtherAddressPostalCode", "OtherAddressState", "OtherAddressStreet", "PagerNumber",,,,, "WebPage",,,,, "Picture"],
  [,,,,,,,,,,,,,,, "DateReceived",, "DisplayTo", "Importance", "MessageClass", "Subject", "Read", "To", "Cc", "From", "ReplyTo", "AllDayEvent", "Categories", "Category", "DtStamp", "EndTime", "InstanceType", "BusyStatus", "Location", "MeetingRequest", "Organizer", "RecurrenceId", "Reminder", "ResponseRequested", "Recurrences", "Recurrence", "Type", "Until", "Occurrences", "Interval", "DayOfWeek", "DayOfMonth", "WeekOfMonth", "MonthOfYear", "StartTime", "Sensitivity", "TimeZone", "GlobalObjId", "ThreadTopic",,,, "InternetCPID", "Flag", "Status", "ContentClass", "FlagType", "CompleteTime", "DisallowNewTimeProposal"],
  [],
  [,,,,, "Timezone", "AllDayEvent", "Attendees", "Attendee", "Email", "Name",,, "BusyStatus", "Categories", "Category",, "DtStamp", "EndTime", "Exception", "Exceptions", "Deleted", "ExceptionStartTime", "Location", "MeetingStatus", "OrganizerEmail", "OrganizerName", "Recurrence", "Type", "Until", "Occurrences", "Interval", "DayOfWeek", "DayOfMonth", "WeekOfMonth", "MonthOfYear", "Reminder", "Sensitivity", "Subject", "StartTime", "UID", "AttendeeStatus", "AttendeeType",,,,,,,,, "DisallowNewTimeProposal", "ResponseRequested", "AppointmentReplyTime", "ResponseType", "CalendarType", "IsLeapMonth", "FirstDayOfWeek", "OnlineMeetingConfLink", "OnlineMeetingExternalLink", "ClientUid"],
  [,,,,, "MoveItems", "Move", "SrcMsgId", "SrcFldId", "DstFldId", "Response", "Status", "DstMsgId"],
  [],
  [,,,,,,, "DisplayName", "ServerId", "ParentId", "Type",, "Status",, "Changes", "Add", "Delete", "Update", "SyncKey", "FolderCreate", "FolderDelete", "FolderUpdate", "FolderSync", "Count"],
  [,,,,, "CalendarId", "CollectionId", "MeetingResponse", "RequestId", "Request", "Result", "Status", "UserResponse",, "InstanceId",,,, "SendResponse"],
  [,,,,,,,, "Categories", "Category", "Complete", "DateCompleted", "DueDate", "UtcDueDate", "Importance", "Recurrence", "Type", "Start", "Until", "Occurrences", "Interval", "DayOfMonth", "DayOfWeek", "WeekOfMonth", "MonthOfYear", "Regenerate", "DeadOccur", "ReminderSet", "ReminderTime", "Sensitivity", "StartDate", "UtcStartDate", "Subject",, "OrdinalDate", "SubOrdinalDate", "CalendarType", "IsLeapMonth", "FirstDayOfWeek"],
  [,,,,, "ResolveRecipients", "Response", "Status", "Type", "Recipient", "DisplayName", "EmailAddress", "Certificates", "Certificate",, "Options", "To", "CertificateRetrieval", "RecipientCount", "MaxCertificates", "MaxAmbiguousRecipients", "CertificateCount", "Availability", "StartTime", "EndTime", "MergedFreeBusy"],
  [],
  [,,,,,,, "IMAddress", "IMAddress2", "IMAddress3",,,, "NickName"],
  [,,,,, "Ping",, "Status", "HeartbeatInterval", "Folders", "Folder", "Id", "Class", "MaxFolders"],
  [,,,,, "Provision", "Policies", "Policy", "PolicyType", "PolicyKey", "Data", "Status", "RemoteWipe", "EASProvisionDoc", "DevicePasswordEnabled", "AlphanumericDevicePasswordRequired", "RequireStorageCardEncryption", "PasswordRecoveryEnabled",, "AttachmentsEnabled", "MinDevicePasswordLength", "MaxInactivityTimeDeviceLock", "MaxDevicePasswordFailedAttempts", "MaxAttachmentSize", "AllowSimpleDevicePassword", "DevicePasswordExpiration", "DevicePasswordHistory", "AllowStorageCard", "AllowCamera", "RequireDeviceEncryption", "AllowUnsignedApplications", "AllowUnsignedInstallationPackages", "MinDevicePasswordComplexCharacters", "AllowWiFi", "AllowTextMessaging", "AllowPOPIMAPEmail", "AllowBluetooth", "AllowIrDA", "RequireManualSyncWhenRoaming", "AllowDesktopSync", "MaxCalendarAgeFilter", "AllowHTMLEmail", "MaxEmailAgeFilter", "MaxEmailBodyTruncationSize", "MaxEmailHTMLBodyTruncationSize", "RequireSignedSMIMEMessages", "RequireEncryptedSMIMEMessages", "RequireSignedSMIMEAlgorithm", "RequireEncryptionSMIMEAlgorithm", "AlowSMIMEEncryptionAlgorithmNegotiation", "AllowSMIMESoftCerts", "AllowBrowser", "AllowConsumerEmail", "AllowRemoteDesktop", "AllowInternetSharing", "UnapprovedInROMApplicationList", "ApplicationName", "ApprovedApplicationList"],
  [,,,,, "Search",, "Store", "Name", "Query", "Options", "Range", "Status", "Response", "Result", "Properties", "Total"],
  [,,,,, "DisplayName", "Phone", "Office", "Title", "Company", "Alias", "FirstName", "LastName", "HomePhone", "MobilePhone", "EmailAddress"],
  [,,,,, "BodyPreference", "Type", "TruncationSize",,, "Body", "Data", "EstimatedDataSize", "Truncated", "Attachments", "Attachment", "DisplayName", "FileReference", "Method", "ContentId", "ContentLocation", "IsInline", "NativeBodyType", "ContentType", "Preview",,,,,,,, "EnhancedLocation", "Annotation", "Street", "City", "State", "Country", "PostalCode", "Latitude", "Longitude", "Accuracy", "Altitude", "AltitudeAccuracy", "LocationUri", "ExceptionId"],
  [,,,,, "Settings", "Status", "Get", "Set", "Oof", "OofState", "StartTime", "EndTime", "OofMessage", "AppliesToInternal", "AppliesToExternalKnown", "AppliesToExternalUnknown", "Enabled", "ReplyMessage", "BodyType",,, "DeviceInformation", "Model"],
  [],
  [,,,,, "ItemOperations", "Fetch", "Store", "Options", "Range", "Total", "Properties", "Data", "Status", "Response",,,, "EmptyFolderContents", "DeleteSubFolders"],
  [,,,,, "SendMail",,, "SaveInSentItems",,,,,,,, "Mime", "ClientId", "Status"],
  [,,,,,,,,, "ConversationId", "ConversationIndex", "LastVerbExecuted", "LastVerbExecutionTime",, "Sender", "CalendarType",,,"FirstDayOfWeek", "MeetingMessageType",, "IsDraft", "Bcc"],
];

/**
 * Translates a request into WBXML
 *
 * @param aJSON {Object}      The request to translate
 * @returns     {ArrayBuffer} The WBXML
 *
 * Note: This function does not handle WBXML attributes, which we don't use.
 */
export function request2WBXML(aRequest: object): Promise<ArrayBuffer> {
  let wbxml = [Uint8Array.of(kWBXMLVersion, kDTD, kUTF8, 0)];
  let currentPage = 0x00;
  let J2W = aJSON => {
    let parentPage = currentPage;
    for (let tag in aJSON) {
      let page = kTags[parentPage].includes(tag) ? parentPage
               : kTags[currentPage].includes(tag) ? currentPage
               : kTags.findIndex(tags => tags.includes(tag));
      if (page < 0) {
        throw new Error("Tag not encodable: " + tag);
      }
      let code = kTags[page].indexOf(tag);
      let values = Array.isArray(aJSON[tag]) ? aJSON[tag] : [aJSON[tag]];
      for (let value of values) {
        if (currentPage != page) {
          currentPage = page;
          wbxml.push(Uint8Array.of(kSwitchPage, page));
        }
        wbxml.push(Uint8Array.of(code | kHasContent));
        if (typeof value != "object") {
          wbxml.push(Uint8Array.of(kInlineString), value, Uint8Array.of(0));
        } else if (value instanceof Uint8Array) {
          let mbi = [value.length];
          while (mbi[0] >= 0x80) {
            mbi.unshift(mbi[0] >> 7);
            mbi[1] &= 0x7F;
          }
          for (let i = 0; i < mbi.length - 1; i++) {
            mbi[i] |= 0x80;
          }
          wbxml.push(Uint8Array.of(kInlineCDATA), new Uint8Array(mbi), value);
        } else {
          J2W(value);
        }
        wbxml.push(Uint8Array.of(kEndTag));
      }
    }
  };
  J2W(aRequest);
  return new Blob(wbxml, { type: "application/vnd.ms-sync.wbxml" }).arrayBuffer();
}

/** Translates an WBXML byte array to a JSON object. */
export function WBXML2JSON(aWBXML: Uint8Array): any {
  if (aWBXML.length < 6 || aWBXML[0] != kWBXMLVersion || aWBXML[1] != kDTD || aWBXML[2] != kUTF8 || aWBXML[3] != 0) {
    throw new Error("Unsupported WBXML version");
  }
  let page = 0;
  let stack: any[] = [{}];
  for (let i = 4; i < aWBXML.length; ) {
    let code = aWBXML[i++];
    if (code == kSwitchPage) {
      if (i == aWBXML.length) {
        throw new Error("Unexpected end of WBXML");
      }
      page = aWBXML[i++]
      if (!kTags[page]) {
        console.log("Warning: unknown code page", page);
        kTags[page] = [];
      }
    } else if (code == kEndTag) {
      stack.shift();
      if (!stack.length) {
        throw new Error("Unbalanced WBXML tag stack");
      }
    } else if (code >= 0x05 && code < 0x40) {
      if (!kTags[page][code]) {
        console.log("Warning: unknown tag in code page", page, code);
        kTags[page][code] = "_" + page + "_" + code;
      }
      let tag = kTags[page][code];
      // XXX handle multiple empty tags?
      stack[0][tag] = "";
    } else if (code >= 0x45 && code < 0x80) {
      if (i == aWBXML.length) {
        throw new Error("Unexpected end of WBXML");
      }
      let current = stack[0];
      let value, rawValue;
      if (aWBXML[i] == kInlineString) {
        let pos = aWBXML.indexOf(0, ++i);
        if (pos < 0) {
          throw new Error("Unexpected end of WBXML");
        }
        rawValue = aWBXML.slice(i, pos);
        value = new TextDecoder().decode(rawValue);
        i = pos + 1;
        if (i == aWBXML.length) {
          throw new Error("Unexpected end of WBXML");
        }
        if (aWBXML[i++] != kEndTag) {
          throw new Error("Unsupported WBXML string");
        }
      } else if (aWBXML[i] == kInlineCDATA) {
        let len = 0;
        do {
          if (++i == aWBXML.length) {
            throw new Error("Unexpected end of WBXML");
          }
          len = len << 7 | aWBXML[i] & 0x7F;
        } while (aWBXML[i] & 0x80);
        if (++i + len >= aWBXML.length) {
          throw new Error("Unexpected end of WBXML");
        }
        value = aWBXML.slice(i, i + len);
        i += len;
        if (aWBXML[i++] != kEndTag) {
          throw new Error("Unsupported WBXML CDATA");
        }
      } else {
        value = {};
        stack.unshift(value);
      }
      code &= 0x3F;
      if (!kTags[page][code]) {
        console.log("Warning: unknown tag in code page", page, code);
        kTags[page][code] = "_" + page + "_" + code;
      }
      let tag = kTags[page][code];
      if (current[tag]) {
        if (!Array.isArray(current[tag])) {
          current[tag] = [current[tag]];
        }
        current[tag].push(value);
      } else {
        current[tag] = value;
      }
      if (tag == 'Data' && !current.RawData) {
        current.RawData = rawValue;
      }
    } else {
      throw new Error("Unsupported WBXML token");
    }
  }
  if (stack.length != 1) {
    throw new Error("Unbalanced WBXML tag stack");
  }
  // There is always only ever one top-level node, so unwrap it now.
  return Object.values(stack[0])[0];
}
