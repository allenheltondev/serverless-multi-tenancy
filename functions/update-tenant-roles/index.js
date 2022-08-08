const { DynamoDBClient, GetItemCommand, UpdateItemCommand } = require('@aws-sdk/client-dynamodb');
const { marshall, unmarshall } = require('@aws-sdk/util-dynamodb');
const { StatusCodes } = require('http-status-codes');

const ddb = new DynamoDBClient();

exports.handler = async (event) => {
  try {
    const input = JSON.parse(event.body);
    const user = await exports.getUserRecord(event.requestContext.authorizer.userId);
    if (!user) {
      console.error('The caller is not a registered user');
      return {
        statusCode: StatusCodes.CONFLICT,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ message: 'You are not a registered user.' })
      };
    }

    const tenantIndex = user.customers.findIndex(c => c.id == event.pathParameters.customerId);
    if(tenantIndex == -1){
      console.error('The caller is not associated to the provided customer.');
      return {
        statusCode: StatusCodes.FORBIDDEN,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ message: 'You are not a member of the provided customer id.' })
      };
    }

    await exports.updateTenantRoles(user, tenantIndex, input.roles);
    return {
      statusCode: StatusCodes.NO_CONTENT,
      headers: { 'Access-Control-Allow-Origin': '*' }
    };
  } catch(err){
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

exports.updateTenantRoles = async (user, index, roles) => {
  const command = new UpdateItemCommand({
    TableName: process.env.TABLE_NAME,
    Key: marshall({
      pk: user.pk,
      sk: user.sk
    }),
    ConditionExpression: 'attribute_exists(#pk)',
    UpdateExpression: `SET #customers[${index}].#roles = :roles`,
    ExpressionAttributeNames: {
      '#pk': 'pk',
      '#customers': 'customers',
      '#roles': 'roles'
    },
    ExpressionAttributeValues: marshall({
      ':roles': roles
    })
  });

  await ddb.send(command);
};