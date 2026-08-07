import ada from "./ada.json";
import airtable from "./airtable.json";
import airtableNative from "./airtable-native.json";
import alpaca from "./alpaca.json";
import appleAppStore from "./apple-app-store.json";
import appsflyer from "./appsflyer.json";
import asana from "./asana.json";
import ashby from "./ashby.json";
import azureBlobStorage from "./azure-blob-storage.json";
import bigqueryBatch from "./bigquery-batch.json";
import braintreeNative from "./braintree-native.json";
import brevo from "./brevo.json";
import calendly from "./calendly.json";
import chargebeeNative from "./chargebee-native.json";
import criteo from "./criteo.json";
import datadog from "./datadog.json";
import db2Batch from "./db2-batch.json";
import dropbox from "./dropbox.json";
import dynamics365FinanceAndOperations from "./dynamics-365-finance-and-operations.json";
import dynamodb from "./dynamodb.json";
import facebookMarketing from "./facebook-marketing.json";
import facebookMarketingNative from "./facebook-marketing-native.json";
import firestore from "./firestore.json";
import front from "./front.json";
import ga4Bigquery from "./ga4-bigquery.json";
import gainsightNxt from "./gainsight-nxt.json";
import gcs from "./gcs.json";
import genesys from "./genesys.json";
import gladly from "./gladly.json";
import gong from "./gong.json";
import googleAds from "./google-ads.json";
import googleAnalyticsDataApiNative from "./google-analytics-data-api-native.json";
import googleDrive from "./google-drive.json";
import googlePlay from "./google-play.json";
import googlePubsub from "./google-pubsub.json";
import googleSheetsNative from "./google-sheets-native.json";
import greenhouseNative from "./greenhouse-native.json";
import httpFile from "./http-file.json";
import hubspot from "./hubspot.json";
import hubspotNative from "./hubspot-native.json";
import impactNative from "./impact-native.json";
import incidentIo from "./incident-io.json";
import intercomNative from "./intercom-native.json";
import iterable from "./iterable.json";
import iterableNative from "./iterable-native.json";
import iterate from "./iterate.json";
import jiraLegacy from "./jira-legacy.json";
import jiraNative from "./jira-native.json";
import kafka from "./kafka.json";
import kinesis from "./kinesis.json";
import klaviyo from "./klaviyo.json";
import klaviyoNative from "./klaviyo-native.json";
import linkedinAdsV2 from "./linkedin-ads-v2.json";
import linkedinPages from "./linkedin-pages.json";
import looker from "./looker.json";
import mailchimpNative from "./mailchimp-native.json";
import mixpanelNative from "./mixpanel-native.json";
import monday from "./monday.json";
import mongodb from "./mongodb.json";
import mysql from "./mysql.json";
import mysqlBatch from "./mysql-batch.json";
import navan from "./navan.json";
import notion from "./notion.json";
import onedrive from "./onedrive.json";
import oracle from "./oracle.json";
import oracleBatch from "./oracle-batch.json";
import outreach from "./outreach.json";
import pendo from "./pendo.json";
import postgres from "./postgres.json";
import postgresBatch from "./postgres-batch.json";
import posthog from "./posthog.json";
import qualtrics from "./qualtrics.json";
import quickbooks from "./quickbooks.json";
import recharge from "./recharge.json";
import redshiftBatch from "./redshift-batch.json";
import ringcentral from "./ringcentral.json";
import s3 from "./s3.json";
import sageIntacct from "./sage-intacct.json";
import salesforceNative from "./salesforce-native.json";
import sentry from "./sentry.json";
import sftp from "./sftp.json";
import sharepoint from "./sharepoint.json";
import shopify from "./shopify.json";
import shopifyNative from "./shopify-native.json";
import smartsheet from "./smartsheet.json";
import snowflake from "./snowflake.json";
import sqlserver from "./sqlserver.json";
import sqlserverBatch from "./sqlserver-batch.json";
import sqlserverCt from "./sqlserver-ct.json";
import sqs from "./sqs.json";
import stripeNative from "./stripe-native.json";
import twilio from "./twilio.json";
import zendeskSupport from "./zendesk-support.json";
import zendeskSupportNative from "./zendesk-support-native.json";
import zoho from "./zoho.json";
import zuora from "./zuora.json";

/**
 * Static imports are intentional: Next's deployment tracer cannot discover a
 * runtime `readdir` reliably. This registry only enumerates source files; it
 * does not transform the mined facts.
 */
export const RAW_CONNECTOR_CORPUS: unknown[] = [
  ada, airtable, airtableNative, alpaca, appleAppStore, appsflyer, asana, ashby,
  azureBlobStorage, bigqueryBatch, braintreeNative, brevo, calendly,
  chargebeeNative, criteo, datadog, db2Batch, dropbox,
  dynamics365FinanceAndOperations, dynamodb, facebookMarketing,
  facebookMarketingNative, firestore, front, ga4Bigquery, gainsightNxt, gcs,
  genesys, gladly, gong, googleAds, googleAnalyticsDataApiNative, googleDrive,
  googlePlay, googlePubsub, googleSheetsNative, greenhouseNative, httpFile,
  hubspot, hubspotNative, impactNative, incidentIo, intercomNative, iterable,
  iterableNative, iterate, jiraLegacy, jiraNative, kafka, kinesis, klaviyo,
  klaviyoNative, linkedinAdsV2, linkedinPages, looker, mailchimpNative,
  mixpanelNative, monday, mongodb, mysql, mysqlBatch, navan, notion, onedrive,
  oracle, oracleBatch, outreach, pendo, postgres, postgresBatch, posthog,
  qualtrics, quickbooks, recharge, redshiftBatch, ringcentral, s3, sageIntacct,
  salesforceNative, sentry, sftp, sharepoint, shopify, shopifyNative, smartsheet,
  snowflake, sqlserver, sqlserverBatch, sqlserverCt, sqs, stripeNative, twilio,
  zendeskSupport, zendeskSupportNative, zoho, zuora,
];
