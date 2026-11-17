import { ThunderbirdProfile } from "../../../../../logic/Mail/Import/Thunderbird/TBProfile";
import { connectToBackend } from "../../../util/backend";
import { expect, test } from 'vitest'
import { ThunderbirdAddressbook } from "../../../../../logic/Mail/Import/Thunderbird/TBAddressbook";

test("Read Thunderbird addressbook", async () => {
  await connectToBackend();
  let profiles = await ThunderbirdProfile.findProfiles();
  expect(profiles.length).toBeGreaterThan(0);
  for (let profile of profiles.filter(p => p.name == "Test")) {
    console.log("Thunderbird default profile name", profile.name, "path", profile.path);
    try {
      let addressbooks = await ThunderbirdAddressbook.readAll(profile);
      for (let addressbook of addressbooks) {
        console.log("Address book", addressbook.name, "from", addressbook.id);
        for (let person of addressbook.persons) {
          console.log("  Person", person.name, person.emailAddresses.first.value);
        }
      }
    } catch (ex) {
      console.log(ex.message);
    }
  }
});
