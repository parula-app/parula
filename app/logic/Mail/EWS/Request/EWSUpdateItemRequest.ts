export class EWSUpdateItemRequest {
  m$UpdateItem: any = {
    m$ItemChanges: {
      t$ItemChange: {
        t$ItemId: {},
        t$Updates: {
          t$SetItemField: [],
          t$DeleteItemField: [],
        },
      },
    },
    ConflictResolution: "AlwaysOverwrite",
  };

  constructor(id: string, attributes?: {[key: string]: string | boolean}) {
    this.itemChange.t$ItemId.Id = id;
    Object.assign(this.m$UpdateItem, attributes);
  }

  protected get itemChange() {
    return this.m$UpdateItem.m$ItemChanges.t$ItemChange;
  }

  /** Sets a MAPI property that EWS has no field for
   * @param PropertyTag the MAPI property tag, e.g. "0x1081"
   * @param PropertyType the MAPI property type, e.g. "Integer" */
  addExtendedField(type: string, PropertyTag: string, PropertyType: string, value: any) {
    let fieldURI = { PropertyTag, PropertyType };
    this.itemChange.t$Updates.t$SetItemField.unshift({
      t$ExtendedFieldURI: fieldURI,
      ["t$" + type]: {
        t$ExtendedProperty: {
          t$ExtendedFieldURI: fieldURI,
          t$Value: value,
        },
      },
    });
  }

  addField(type: string, key: string, value: any, FieldURI: string, FieldIndex?: string) {
    let field = {} as any;
    if (FieldIndex) {
      field.t$IndexedFieldURI = { FieldURI, FieldIndex };
    } else {
      field.t$FieldURI = { FieldURI };
    }
    if (value == null) {
      this.itemChange.t$Updates.t$DeleteItemField.unshift(field);
    } else {
      field["t$" + type] = { ["t$" + key]: value };
      this.itemChange.t$Updates.t$SetItemField.unshift(field); // reverse order for Event time zone
    }
  }
}
