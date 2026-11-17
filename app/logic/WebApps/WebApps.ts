import { WebAppCategory } from "./WebAppCategory";
import { WebAppListed } from "./WebAppListed";
import appStore from "./webAppStore.json";
import { sanitize } from "../../../lib/util/sanitizeDatatypes";
import { MapColl, ArrayColl } from 'svelte-collections';
import { showError } from "../util/error";
import { filterUnique } from "../util/collections";

export class WebApps {
  /** fullID -> AppCategory */
  readonly categories = new MapColl<string, WebAppCategory>();
  readonly apps = new MapColl<string, WebAppListed>();
  readonly myApps = new ArrayColl<WebAppListed>();
  readonly runningApps = new ArrayColl<WebAppListed>();

  async load() {
    if (this.apps.hasItems) {
      return;
    }
    this.loadStore();
    this.loadMyApps();
    this.myApps.subscribe(() => {
      this.categories.get("selectedApps").apps = filterUnique(this.myApps, (a, b) => a.id == b.id);
      this.saveMyApps();
    });
  }

  loadStore() {
    for (let json of appStore.categories) {
      let cat = WebAppCategory.fromJSON(json);
      this.categories.set(cat.fullID, cat);
    }
    this.apps.addAll(appStore.apps.map(json => WebAppListed.fromJSON(json)));
    for (let category of this.categories) {
      let apps = this.apps.contents.filter(app => app.categoryFullIDs.includes(category.fullID));
      category.apps.addAll(apps);
    }
  }

  loadMyApps() {
    try {
      let configuredApps = sanitize.array(JSON.parse(sanitize.nonemptystring(localStorage.getItem("webapps.selected"), null)), []);
      for (let json of configuredApps) {
        try {
          let app = WebAppListed.fromJSON(json);
          this.myApps.add(app);
        } catch (ex) {
          console.log("Configured webapp could not be read", ex);
        }
      }
    } catch (ex) {
      showError(ex);
    }
  }

  saveMyApps() {
    let json = this.myApps.contents.map(app => app.toJSON());
    localStorage.setItem("webapps.selected", JSON.stringify(json));
  }
}
