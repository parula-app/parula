import sql from "../../../../lib/rs-sqlite/index";

/** Until #1916, "Add to address book" on our own address could give the
 * contact our secret PGP key and its passphrase. Removes them, and keeps
 * the public keys. `migrate()` runs it only once.
 * `octet_length()` skips contacts with small JSON, as `removeSecretKeyOfSigner()` does. */
export const removeSecretKeysOfContacts = sql`
  UPDATE person
  SET json = json_set(json, '$.encryptionPublicKeys', json((
    SELECT json_group_array(json_remove(value, '$.privateKeyArmored', '$.passphrase'))
    FROM json_each(person.json, '$.encryptionPublicKeys'))))
  WHERE octet_length(json) > 1000 AND instr(json, '"privateKeyArmored"') AND json_valid(json);
`;
