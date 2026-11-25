import sql from "../../../../lib/rs-sqlite/index";

export const topicDatabaseSchema = sql`
  CREATE TABLE "topic" (
    "id" INTEGER PRIMARY KEY,
    "idStr" TEXT default null,
    "accountID" INTEGER not null,
    -- title of topic
    "name" TEXT default null,
    -- DB id of parent topic
    "parentID" INTEGER default null,
    -- Paragraphs or data elements
    -- JSON array of object with: either a paragraph or a data element
    "contentsJSON" TEXT default null,
    -- Properties
    -- JSON array of object with: property, value
    "propertiesJSON" TEXT default null,
    -- Linked objects
    -- JSON array of object with: property, link target type and target id
    "linksJSON" TEXT default null,
    -- Additional data
    "json" TEXT default null,
    -- When the topic was last changed, as Unix time in ms
    "lastMod" INTEGER default null,
    FOREIGN KEY (accountID)
      REFERENCES topicAccount (ID)
      ON DELETE CASCADE
  );

  -- Must match the data in accounts DB
  CREATE TABLE "topicAccount" (
    "id" INTEGER PRIMARY KEY,
    "idStr" TEXT not null UNIQUE,
    "protocol" TEXT not null
  );
`;
