
import * as yup from "yup";
import { yupNumber, yupObject, yupString } from "../schema-fields";

export const geoInfoSchema = yupObject({
  ip: yupString().defined(),
  countryCode: yupString().nullable(),
  regionCode: yupString().nullable(),
  cityName: yupString().nullable(),
  latitude: yupNumber().nullable(),
  longitude: yupNumber().nullable(),
  tzIdentifier: yupString().nullable(),
});

export type GeoInfo = yup.InferType<typeof geoInfoSchema>;

