
import * as yup from "yup";
import { yupNumber, yupObject, yupString } from "../schema-fields";

export const geoInfoSchema = yupObject({
  ip: yupString().defined(),
  countryCode: yupString().defined(),
  regionCode: yupString().defined(),
  cityName: yupString().defined(),
  latitude: yupNumber().defined(),
  longitude: yupNumber().defined(),
  tzIdentifier: yupString().defined(),
});

export type GeoInfo = yup.InferType<typeof geoInfoSchema>;

