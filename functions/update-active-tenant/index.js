const { DynamoDBClient, GetItemCommand, UpdateItemCommand } = require('@aws-sdk/client-dynamodb');
const { marshall, unmarshall } = require('@aws-sdk/util-dynamodb');
const { StatusCodes } = require('http-status-codes');

const ddb = new DynamoDBClient();

exports.handler = async (event) => {
  try {
    const input = JSON.parse(event.body);
    if (input.customerId == event.requestContext.authorizer.customerId) {
      return {
        statusCode: StatusCodes.NO_CONTENT,
        headers: { 'Access-Control-Allow-Origin': '*' }
      }
    }

    const user = await exports.getUserRecord(event.requestContext.authorizer.userId);
    if (!user) {
      console.error('The caller is not a registered user');
      return {
        statusCode: StatusCodes.CONFLICT,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ message: 'You are not a registered user.' })
      };
    }

    if (!user.customers.find(c => c.id == input.customerId)) {
      console.error('The caller is not associated to the provided customer.');
      return {
        statusCode: StatusCodes.FORBIDDEN,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ message: 'You are not a member of the provided customer id.' })
      };
    }

    await exports.updateActiveTenant(event.requestContext.authorizer.userId, input.customerId);
    return {
      statusCode: StatusCodes.NO_CONTENT,
      headers: { 'Access-Control-Allow-Origin': '*' }
    };
  } catch (err) {
    console.error(err);
    return {
      statusCode: StatusCodes.INTERNAL_SERVER_ERROR,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ message: 'Something went wrong.' })
    };
  }
};

exports.getUserRecord = async (userId) => {
  const command = new GetItemCommand({
    TableName: process.env.TABLE_NAME,
    Key: marshall({
      pk: userId,
      sk: 'user#'
    })
  });

  const result = await ddb.send(command);
  if (result?.Item) {
    return unmarshall(result.Item);
  }
};

exports.updateActiveTenant = async (userId, customerId) => {
  const command = new UpdateItemCommand({
    TableName: process.env.TABLE_NAME,
    Key: marshall({
      pk: userId,
      sk: 'user#'
    }),
    UpdateExpression: 'SET #active.#customerId = :customerId',
    ExpressionAttributeNames: {
      '#active': 'active',
      '#customerId': 'customerId'
    },
    ExpressionAttributeValues: marshall({
      ':customerId': customerId
    })
  });

  await ddb.send(command);
};