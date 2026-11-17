import type { TopicAccount } from "../TopicAccount";
import { setRootTopic } from "../TopicAccounts";
import { Topic, type ValueProperty } from "../Topic";
import { Paragraph } from "../PageContent";
import { getDatabase } from "./SQLDatabase";
import { sanitize } from "../../../../lib/util/sanitizeDatatypes";
import { dataError } from "../../util/error";
import { assert } from "../../util/util";
import { ArrayColl } from "svelte-collections";
import sql from "../../../../lib/rs-sqlite";

export class SQLTopic {
  static async save(topic: Topic) {
    assert(topic.account?.dbID, "Need topic account DB ID to save topic");
    if (!topic.dbID) {
      let existing = await (await getDatabase()).get(sql`
        SELECT
          id
        FROM topic
        WHERE
          idStr = ${topic.id}
        `) as any;
      if (existing?.id) {
        topic.dbID = existing.id;
      }
    }
    if (!topic.dbID) {
      let insert = await (await getDatabase()).run(sql`
        INSERT INTO topic (
          idStr, accountID, name, parentID,
          contentsJSON, propertiesJSON, linksJSON,
          json
        ) VALUES (
          ${topic.id}, ${topic.account.dbID}, ${topic.name}, ${topic.parent?.dbID ?? null},
          ${SQLTopic.saveContents(topic)},
          ${SQLTopic.saveProperties(topic)},
          ${SQLTopic.saveLinks(topic)},
          null
        )`);
      topic.dbID = insert.lastInsertRowid;
    } else {
      await (await getDatabase()).run(sql`
        UPDATE topic SET
          idStr = ${topic.id},
          name = ${topic.name},
          accountID = ${topic.account.dbID},
          parentID = ${topic.parent?.dbID ?? null},
          contentsJSON = ${SQLTopic.saveContents(topic)},
          propertiesJSON = ${SQLTopic.saveProperties(topic)},
          linksJSON = ${SQLTopic.saveLinks(topic)},
          json = null
        WHERE id = ${topic.dbID}
        `);
    }
  }

  static async read(dbID: number, topic: Topic): Promise<void> {
    assert(topic.account?.dbID, "Need account to read topic");
    assert(dbID, "Need DB ID to read topic");
    let row = await (await getDatabase()).get(sql`
      SELECT
        idStr, name, parentID,
        contentsJSON, propertiesJSON, linksJSON,
        json
      FROM topic
      WHERE id = ${dbID}
      `) as any;
    SQLTopic.readFromRow(dbID, topic, row);
  }

  protected static readFromRow(dbID: number, topic: Topic, row: any) {
    topic.dbID = sanitize.integer(dbID);
    topic.id = sanitize.nonemptystring(row.idStr);
    topic.name = sanitize.string(row.name, "");
    SQLTopic.readContents(topic, sanitize.json(row.contentsJSON, []));
    SQLTopic.readProperties(topic, sanitize.json(row.propertiesJSON, []));
    //SQLTopic.readLinks(topic, sanitize.json(row.linksJSON, []));
  }

  protected static readContents(topic: Topic, contents: ContentJSON[]) {
    topic.content.clear();
    for (let content of contents) {
      try {
        if (content.type == "paragraph") {
          let c = new Paragraph(topic);
          c.rawHTMLDangerous = sanitize.string(content.html, "");
        }
      } catch (ex) {
        dataError(ex);
      }
    }
  }

  protected static saveContents(topic: Topic): string {
    let contents: ContentJSON[] = [];
    for (let content of topic.content) {
      if (content instanceof Paragraph) {
        contents.push({
          type: "paragraph",
          html: content.rawHTMLDangerous,
        });
      }
    }
    return JSON.stringify(contents);
  }

  protected static readProperties(topic: Topic, properties: ValueProperty[]) {
    topic.properties.replaceAll(properties);
  }

  protected static saveProperties(topic: Topic): string {
    return JSON.stringify(topic.properties.contents);
  }

  protected static readLinks(topic: Topic, links: any[]) {
    // TODO implement
  }

  protected static saveLinks(topic: Topic): string {
    // TODO implement
    return "[]";
  }

  static async deleteIt(topic: Topic) {
    assert(topic.dbID, "Need topic DB ID to delete");
    await (await getDatabase()).run(sql`
      DELETE FROM topic
      WHERE id = ${topic.dbID}
      `);
  }

  static async readAll(topicAccount: TopicAccount): Promise<void> {
    let rows = await (await getDatabase()).all(sql`
      SELECT
        id, idStr, name, parentID,
        contentsJSON, propertiesJSON, linksJSON,
        json
      FROM topic
      WHERE accountID = ${topicAccount.dbID}
      `) as any[];
    let newTopics = new ArrayColl<Topic>();
    for (let row of rows) {
      try {
        let topic = topicAccount.topics.find(topic => topic.dbID == row.id);
        if (topic) {
          SQLTopic.readFromRow(row.id, topic, row);
        } else {
          topic = new Topic();
          topic.account = topicAccount;
          SQLTopic.readFromRow(row.id, topic, row);
          (topic as any)._parentDBID = sanitize.integer(row.parentID, null);
          newTopics.add(topic);
        }
      } catch (ex) {
        topicAccount.errorCallback(ex);
      }
    }
    // Set parent as object, after reading all topics
    for (let topic of newTopics) {
      let parentDBID = (topic as any)._parentDBID;
      topic.parent = topicAccount.topics.find(t => t.dbID == parentDBID)
        ?? newTopics.find(t => t.dbID == parentDBID)
        ?? null;
      if (topic.parent) {
        topic.parent?.children.add(topic);
      } else {
        setRootTopic(topic);
      }
    }
    topicAccount.topics.addAll(newTopics);
  }
}

type ContentJSON = ParagraphJSON;

class ParagraphJSON {
  type = "paragraph";
  html: string;
}
