import { OWARequest } from "./OWARequest";

export class OWAUpdateItemRequest extends OWARequest {
  Body: any = {
    __type: "UpdateItemRequest:#Exchange",
    ConflictResolution: "AlwaysOverwrite",
    ItemChanges: [{
      __type: "ItemChange:#Exchange",
      ItemId: {
        __type: "ItemId:#Exchange",
      },
      Updates: []
    }],
  };

  constructor(id: string, attributes?: { [key: string]: string | boolean | object }) {
    super("UpdateItem");
    this.itemChange.ItemId.Id = id;
    Object.assign(this.Body, attributes);
  }

  protected get itemChange() {
    return this.Body.ItemChanges[0];
  }

  /** Sets a MAPI property that OWA has no field for
   * @param PropertyTag the MAPI property tag, e.g. "0x1081"
   * @param PropertyType the MAPI property type, e.g. "Integer" */
  addExtendedField(type: string, PropertyTag: string, PropertyType: string, value: any) {
    this.itemChange.Updates.unshift({
      __type: "SetItemField:#Exchange",
      Path: {
        __type: "ExtendedPropertyUri:#Exchange",
        PropertyTag,
        PropertyType,
      },
      Item: {
        __type: type + ":#Exchange",
        ExtendedProperty: [{
          ExtendedFieldURI: { PropertyTag, PropertyType },
          Value: String(value),
        }],
      },
    });
  }

  addField(type: string, key: string, value: any, FieldURI: string) {
    let field = {
      __type: "DeleteItemField:#Exchange",
      Path: {
        __type: "PropertyUri:#Exchange",
        FieldURI: FieldURI,
      },
    } as any;
    if (value != null) {
      field.__type = "SetItemField:#Exchange";
      field.Item = {
        __type: type + ":#Exchange",
      };
      field.Item[key] = value;
    }
    this.itemChange.Updates.unshift(field); // reverse order for Event time zone
  }
}
